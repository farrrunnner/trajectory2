use std::{fs, path::Path};

use anyhow::{Context, Result};

use crate::models::Settings;

pub fn load_settings(path: &Path) -> Result<Settings> {
    if !path.exists() {
        return Ok(Settings::default());
    }

    let text = fs::read_to_string(path)
        .with_context(|| format!("failed reading settings file {}", path.display()))?;
    let settings = serde_json::from_str(&text)
        .with_context(|| format!("failed parsing settings file {}", path.display()))?;
    Ok(settings)
}

pub fn save_settings(path: &Path, settings: &Settings) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed creating settings directory {}", parent.display()))?;
    }

    let text = serde_json::to_string_pretty(settings)?;
    fs::write(path, text)
        .with_context(|| format!("failed writing settings file {}", path.display()))?;
    Ok(())
}
