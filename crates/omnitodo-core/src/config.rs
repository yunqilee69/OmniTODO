use std::path::PathBuf;

/// Resolve the user's home directory.
///
/// On Windows `USERPROFILE` wins: a GUI process launched from explorer has it
/// but usually no `HOME`, while a Git-Bash/MSYS shell sets `HOME` to a
/// POSIX-style path (`/c/Users/...`) that would not resolve as a native path.
/// Unix uses `HOME`.
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            if !profile.is_empty() {
                return Some(PathBuf::from(profile));
            }
        }
        if let (Some(drive), Some(path)) =
            (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH"))
        {
            let mut p = PathBuf::from(drive);
            p.push(path);
            return Some(p);
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }

    None
}

/// Resolve the application data directory: `~/.omnitodo` on every platform
/// (design §4.4).
///
/// Kept in the user's home rather than the OS-specific app-data location so a
/// single visible dotfolder holds the DB, managed attachments and any future
/// sidecar files, and so the path is identical across platforms.
///
/// `OMNITODO_DATA_DIR` overrides the whole thing (used by tests and by the
/// headless CLI / MCP when run against a non-default DB).
pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OMNITODO_DATA_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }

    if let Some(home) = home_dir() {
        return home.join(".omnitodo");
    }

    PathBuf::from(".omnitodo")
}

/// `<data_dir>/omnitodo.db`
pub fn db_path() -> PathBuf {
    data_dir().join("omnitodo.db")
}

/// `<data_dir>/attachments` — managed attachment store (design §4.4).
pub fn attachments_dir() -> PathBuf {
    data_dir().join("attachments")
}

/// Ensure the data directory (and managed attachment root) exist.
pub fn ensure_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir())?;
    std::fs::create_dir_all(attachments_dir())?;
    Ok(())
}
