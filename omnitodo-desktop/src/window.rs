//! Raising the main window.
//!
//! Every entry point reachable while the app is minimised or buried behind
//! another window — the tray menu, the global shortcut, a deep link — has to
//! bring the window forward first. What those entry points drive (the quick-add
//! panel, the focused task) renders *inside* that window, so acting without
//! raising it is indistinguishable from the action failing.

use tauri::{AppHandle, Manager};

/// Bring the main window to the front, restoring it if it was minimised.
pub fn raise_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}
