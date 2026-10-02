#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analytics;
mod countries;
mod db;
mod decoupling;
mod models;
mod parser;
mod scanner;
mod settings;

use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use models::{
    ActivityDetail, ActivityFilters, ActivitySampleQuery, ActivitySamplesResponse, ActivitySummary,
    AdvancedAnalyticsRunRequest, AdvancedAnalyticsRunResponse, AerobicDecouplingRequest,
    AerobicDecouplingResponse, CountryActivityData, HeatmapData, HeatmapFilters, ScanDoneEvent,
    Settings,
};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone)]
struct AppState {
    db_path: PathBuf,
    settings_path: PathBuf,
}

fn is_supported_accent_theme(value: &str) -> bool {
    matches!(
        value,
        "citrus-orange"
            | "pacific-blue"
            | "alpine-green"
            | "crimson-rose"
            | "flamingo-pink"
            | "violet-indigo"
    )
}

fn validate_chart_max_samples(value: usize) -> Result<usize, String> {
    if (100..=20_000).contains(&value) {
        Ok(value)
    } else {
        Err("chart max samples must be between 100 and 20000".to_string())
    }
}

fn validate_heart_rate_zone_upper_bounds_bpm(values: Vec<u16>) -> Result<Vec<u16>, String> {
    if values.len() != 4 {
        return Err("heart rate zones require exactly 4 upper bounds (Z1-Z4)".to_string());
    }

    let mut previous = 0_u16;
    for (index, value) in values.iter().copied().enumerate() {
        if !(40..=260).contains(&value) {
            return Err(format!(
                "heart rate zone bound {} must be between 40 and 260 bpm",
                index + 1
            ));
        }
        if index > 0 && value <= previous {
            return Err("heart rate zone upper bounds must be strictly increasing".to_string());
        }
        previous = value;
    }

    Ok(values)
}

fn init_state(app: &AppHandle) -> Result<AppState> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("failed resolving app data directory")?;
    fs::create_dir_all(&data_dir)
        .with_context(|| format!("failed creating app data dir {}", data_dir.display()))?;

    let config_dir = app
        .path()
        .app_config_dir()
        .context("failed resolving app config directory")?;
    fs::create_dir_all(&config_dir)
        .with_context(|| format!("failed creating app config dir {}", config_dir.display()))?;

    let db_path = data_dir.join("activities.sqlite");
    db::init_db(&db_path)?;

    let settings_path = config_dir.join("settings.json");
    if !settings_path.exists() {
        settings::save_settings(&settings_path, &Settings::default())?;
    }

    Ok(AppState {
        db_path,
        settings_path,
    })
}

fn load_app_settings(state: &AppState) -> Result<Settings, String> {
    settings::load_settings(&state.settings_path).map_err(|err| err.to_string())
}

fn save_app_settings(state: &AppState, settings_value: &Settings) -> Result<(), String> {
    settings::save_settings(&state.settings_path, settings_value).map_err(|err| err.to_string())
}

fn update_app_settings(
    state: &AppState,
    update: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    let mut settings = load_app_settings(state)?;
    update(&mut settings)?;
    save_app_settings(state, &settings)?;
    Ok(settings)
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    load_app_settings(state.inner())
}

#[tauri::command]
async fn set_import_folder(
    path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    let canonical = fs::canonicalize(&path)
        .map_err(|err| format!("invalid import folder path {path}: {err}"))?;

    if !canonical.is_dir() {
        return Err(format!(
            "import folder is not a directory: {}",
            canonical.display()
        ));
    }

    update_app_settings(state.inner(), move |settings| {
        settings.import_folder_path = Some(canonical.to_string_lossy().to_string());
        settings.scan_recursive = recursive;
        Ok(())
    })
}

#[tauri::command]
async fn set_dark_mode(dark_mode: bool, state: State<'_, AppState>) -> Result<Settings, String> {
    update_app_settings(state.inner(), |settings| {
        settings.dark_mode = dark_mode;
        Ok(())
    })
}

#[tauri::command]
async fn set_accent_theme(
    accent_theme: String,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    if !is_supported_accent_theme(&accent_theme) {
        return Err(format!("unsupported accent theme: {accent_theme}"));
    }

    update_app_settings(state.inner(), move |settings| {
        settings.accent_theme = accent_theme;
        Ok(())
    })
}

#[tauri::command]
async fn set_heatmap_full_opacity(
    heatmap_full_opacity: bool,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    update_app_settings(state.inner(), |settings| {
        settings.heatmap_full_opacity = heatmap_full_opacity;
        Ok(())
    })
}

#[tauri::command]
async fn set_chart_max_samples(
    chart_max_samples: usize,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    let chart_max_samples = validate_chart_max_samples(chart_max_samples)?;
    update_app_settings(state.inner(), move |settings| {
        settings.chart_max_samples = chart_max_samples;
        Ok(())
    })
}

#[tauri::command]
async fn set_chart_outlier_removal(
    chart_outlier_removal: bool,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    update_app_settings(state.inner(), move |settings| {
        settings.chart_outlier_removal = chart_outlier_removal;
        Ok(())
    })
}

#[tauri::command]
async fn set_heart_rate_zone_upper_bounds_bpm(
    upper_bounds_bpm: Vec<u16>,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    let upper_bounds_bpm = validate_heart_rate_zone_upper_bounds_bpm(upper_bounds_bpm)?;
    update_app_settings(state.inner(), move |settings| {
        settings.heart_rate_zone_upper_bounds_bpm = upper_bounds_bpm;
        Ok(())
    })
}

#[tauri::command]
async fn scan_import_folder(
    app: AppHandle,
    full_rescan: Option<bool>,
    state: State<'_, AppState>,
) -> Result<ScanDoneEvent, String> {
    let db_path = state.db_path.clone();
    let settings_path = state.settings_path.clone();
    let full_rescan = full_rescan.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_import_folder(&app, &db_path, &settings_path, full_rescan)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn list_activities(
    filters: Option<ActivityFilters>,
    state: State<'_, AppState>,
) -> Result<Vec<ActivitySummary>, String> {
    let db_path = state.db_path.clone();
    let filters = filters.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_connection(&db_path).map_err(|err| err.to_string())?;
        db::list_activities(&conn, &filters).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_activity(id: i64, state: State<'_, AppState>) -> Result<ActivityDetail, String> {
    let db_path = state.db_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_connection(&db_path).map_err(|err| err.to_string())?;
        db::get_activity(&conn, id).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_activity_samples(
    id: i64,
    query: Option<ActivitySampleQuery>,
    state: State<'_, AppState>,
) -> Result<ActivitySamplesResponse, String> {
    let db_path = state.db_path.clone();
    let query = query.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_connection(&db_path).map_err(|err| err.to_string())?;
        db::get_activity_samples(&conn, id, &query).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_aerobic_decoupling(
    request: AerobicDecouplingRequest,
    state: State<'_, AppState>,
) -> Result<AerobicDecouplingResponse, String> {
    let db_path = state.db_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_connection(&db_path).map_err(|err| err.to_string())?;
        let detail = db::get_activity(&conn, request.activity_id).map_err(|err| err.to_string())?;
        let samples = db::get_all_activity_samples(&conn, request.activity_id)
            .map_err(|err| err.to_string())?;
        decoupling::calculate_aerobic_decoupling(&request, &samples, &detail.pause_segments)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_heatmap_data(
    filters: Option<HeatmapFilters>,
    state: State<'_, AppState>,
) -> Result<HeatmapData, String> {
    let db_path = state.db_path.clone();
    let filters = filters.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_connection(&db_path).map_err(|err| err.to_string())?;
        db::get_heatmap_data(&conn, &filters).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_country_activity_data(
    filters: Option<HeatmapFilters>,
    state: State<'_, AppState>,
) -> Result<CountryActivityData, String> {
    let db_path = state.db_path.clone();
    let filters = filters.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_connection(&db_path).map_err(|err| err.to_string())?;
        countries::get_country_activity_data(&conn, &filters).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn run_advanced_analytics(
    request: AdvancedAnalyticsRunRequest,
    state: State<'_, AppState>,
) -> Result<AdvancedAnalyticsRunResponse, String> {
    let db_path = state.db_path.clone();
    let settings_path = state.settings_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_connection(&db_path).map_err(|err| err.to_string())?;
        let settings = settings::load_settings(&settings_path).map_err(|err| err.to_string())?;
        analytics::run_advanced_analytics(
            &conn,
            &request,
            &settings.heart_rate_zone_upper_bounds_bpm,
        )
        .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn export_analytics_json(
    folder_path: String,
    file_name: String,
    file_text: String,
) -> Result<String, String> {
    if file_name.trim().is_empty() {
        return Err("export file name cannot be empty".to_string());
    }

    let folder = fs::canonicalize(&folder_path)
        .map_err(|err| format!("invalid export folder path {folder_path}: {err}"))?;
    if !folder.is_dir() {
        return Err(format!(
            "export folder is not a directory: {}",
            folder.display()
        ));
    }

    let file_path = folder.join(file_name);
    fs::write(&file_path, file_text)
        .map_err(|err| format!("failed writing export file {}: {err}", file_path.display()))?;

    Ok(file_path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = init_state(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_import_folder,
            set_dark_mode,
            set_accent_theme,
            set_heatmap_full_opacity,
            set_chart_max_samples,
            set_chart_outlier_removal,
            set_heart_rate_zone_upper_bounds_bpm,
            scan_import_folder,
            list_activities,
            get_activity,
            get_activity_samples,
            get_aerobic_decoupling,
            get_heatmap_data,
            get_country_activity_data,
            run_advanced_analytics,
            export_analytics_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
