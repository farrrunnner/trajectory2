use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::{
    db::{self, UpsertResult},
    models::{ScanDoneEvent, ScanProgressEvent},
    parser, settings,
};

fn is_activity_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            lower == "tcx" || lower == "txc" || lower == "fit"
        })
        .unwrap_or(false)
}

fn collect_activity_files(root: &Path, recursive: bool) -> Result<Vec<PathBuf>> {
    if !root.exists() {
        return Err(anyhow!("import folder does not exist: {}", root.display()));
    }

    if !root.is_dir() {
        return Err(anyhow!(
            "import folder is not a directory: {}",
            root.display()
        ));
    }

    let mut files = Vec::new();

    if recursive {
        for entry in WalkDir::new(root)
            .into_iter()
            .filter_entry(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            .filter_map(|entry| entry.ok())
        {
            if entry.file_type().is_file() && is_activity_file(entry.path()) {
                files.push(entry.into_path());
            }
        }
    } else {
        for entry in fs::read_dir(root)
            .with_context(|| format!("failed reading import folder {}", root.display()))?
        {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let path = entry.path();
                if is_activity_file(&path) {
                    files.push(path);
                }
            }
        }
    }

    files.sort();
    Ok(files)
}

pub fn scan_import_folder(
    app: &AppHandle,
    db_path: &Path,
    settings_path: &Path,
    full_rescan: bool,
) -> Result<ScanDoneEvent> {
    let mut settings = settings::load_settings(settings_path)?;

    let import_folder = settings
        .import_folder_path
        .clone()
        .ok_or_else(|| anyhow!("no import folder selected"))?;

    let files = collect_activity_files(Path::new(&import_folder), settings.scan_recursive)?;
    let scan_targets: Vec<(PathBuf, String)> = files
        .into_iter()
        .map(|original_path| {
            let canonical_path =
                fs::canonicalize(&original_path).unwrap_or_else(|_| original_path.clone());
            let source_path = canonical_path.to_string_lossy().to_string();
            (canonical_path, source_path)
        })
        .collect();
    let discovered_paths: HashSet<String> = scan_targets
        .iter()
        .map(|(_, source_path)| source_path.clone())
        .collect();
    let total = scan_targets.len();

    let mut conn = db::open_connection(db_path)?;
    if full_rescan {
        db::clear_activity_cache(&mut conn)?;
    }

    let mut known_files = db::source_file_meta_map(&conn)?;
    if !full_rescan {
        let stale_paths: Vec<String> = known_files
            .keys()
            .filter(|known_path| !discovered_paths.contains(*known_path))
            .cloned()
            .collect();

        for stale_path in stale_paths {
            db::delete_activity_by_source_path(&conn, &stale_path)?;
        }

        known_files = db::source_file_meta_map(&conn)?;
    }

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (index, (canonical_path, source_path)) in scan_targets.into_iter().enumerate() {
        let metadata = match fs::metadata(&canonical_path) {
            Ok(meta) => meta,
            Err(err) => {
                errors.push(format!(
                    "{}: metadata error ({err})",
                    canonical_path.display()
                ));
                app.emit(
                    "scan:progress",
                    ScanProgressEvent {
                        parsed: index + 1,
                        total,
                        current_file: source_path,
                    },
                )
                .ok();
                continue;
            }
        };

        let source_size = metadata.len() as i64;
        let source_mtime = metadata
            .modified()
            .ok()
            .and_then(|mtime| mtime.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or_default();

        let unchanged = known_files
            .get(&source_path)
            .map(|known| {
                known.source_size == source_size
                    && known.source_mtime == source_mtime
                    && known.parser_version == db::ACTIVITY_PARSER_VERSION
            })
            .unwrap_or(false);

        if unchanged && !full_rescan {
            skipped += 1;
            app.emit(
                "scan:progress",
                ScanProgressEvent {
                    parsed: index + 1,
                    total,
                    current_file: source_path.clone(),
                },
            )
            .ok();
            continue;
        }

        match parser::parse_activity_file(&canonical_path).and_then(|parsed| {
            db::upsert_activity(&mut conn, &source_path, source_mtime, source_size, &parsed)
        }) {
            Ok(UpsertResult::Added) => added += 1,
            Ok(UpsertResult::Updated) => updated += 1,
            Err(err) => {
                if parser::is_no_trackpoints_error(&err) {
                    skipped += 1;
                } else {
                    errors.push(format!("{}: {}", canonical_path.display(), err));
                }
            }
        }

        app.emit(
            "scan:progress",
            ScanProgressEvent {
                parsed: index + 1,
                total,
                current_file: source_path.clone(),
            },
        )
        .ok();
    }

    settings.last_scan_timestamp = Some(Utc::now().to_rfc3339());
    settings::save_settings(settings_path, &settings)?;

    let done = ScanDoneEvent {
        added,
        updated,
        skipped,
        errors,
    };

    app.emit("scan:done", done.clone()).ok();

    Ok(done)
}
