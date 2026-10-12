//! Global shortcut: brings up the quick-add window (design §12).

use tauri::{AppHandle, Emitter};

/// Register the global quick-add shortcut. Default: `CmdOrCtrl+Shift+Space`.
///
/// Returns the plugin error as text: a taken accelerator must not abort
/// startup, and the caller only logs it.
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let accel = accelerator.to_string();
    app.global_shortcut()
        .on_shortcut(accel.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit("quickadd:open", ());
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
