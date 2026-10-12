use std::path::PathBuf;

/// Resolve the per-platform application data directory, matching design §4.4.
///
/// - Windows: `%APPDATA%\OmniTODO\`
/// - macOS:   `~/Library/Application Support/OmniTODO/`
/// - Linux:   `$XDG_DATA_HOME/omnitodo/` (default `~/.local/share/omnitodo/`)
pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OMNITODO_DATA_DIR") {
        return PathBuf::from(dir);
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("OmniTODO");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("OmniTODO");
        }
    }

    // Linux / other unix: XDG_DATA_HOME or ~/.local/share
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            return PathBuf::from(xdg).join("omnitodo");
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".local").join("share").join("omnitodo");
    }

    PathBuf::from(".omnitodo-data")
}

/// `<data_dir>/omnitodo.db`
pub fn db_path() -> PathBuf {
    data_dir().join("omnitodo.db")
}

/// `<data_dir>/.omnitodo/attachments` — managed attachment store (design §4.4).
pub fn attachments_dir() -> PathBuf {
    data_dir().join(".omnitodo").join("attachments")
}

/// Ensure the data directory (and managed attachment root) exist.
pub fn ensure_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir())?;
    std::fs::create_dir_all(attachments_dir())?;
    Ok(())
}
