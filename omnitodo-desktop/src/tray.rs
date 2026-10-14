//! System tray (design §13): show window, quick add, quit.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

use crate::window::raise_main;

/// Event the frontend listens on to raise the floating quick-add panel.
const QUICK_ADD_EVENT: &str = "quickadd:open";

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quickadd", "快速添加…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &quit])?;

    TrayIconBuilder::new()
        .icon(tray_icon(app))
        .menu(&menu)
        .tooltip("OmniTODO")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => raise_main(app),
            "quickadd" => {
                // The panel renders inside the main window, so the window has to
                // come forward first: the tray menu is usually reached *because*
                // the app is minimised or buried, and an emit on its own opens
                // the panel behind whatever the user is looking at — which is
                // indistinguishable from nothing happening at all.
                raise_main(app);
                let _ = app.emit(QUICK_ADD_EVENT, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                raise_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Icon for the notification area.
///
/// It has to be set explicitly: a `TrayIconBuilder` with no icon registers an
/// empty image, which Windows paints as a blank slot next to the clock. The
/// app's own window icon is preferred (it tracks `bundle.icon` on every
/// platform); the embedded 32×32 is the fallback for a context that carries no
/// icon, since a blank tray entry hides both the menu and the way to exit.
fn tray_icon(app: &AppHandle) -> tauri::image::Image<'_> {
    match app.default_window_icon() {
        Some(icon) => icon.clone(),
        None => tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
            .expect("bundled 32x32 tray icon must decode"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fallback is only reached when the build has no window icon to lend
    /// the tray, so nothing else would notice if the bundled PNG were corrupt —
    /// and a tray entry that fails to decode takes the menu and the quit item
    /// with it.
    #[test]
    fn embedded_fallback_icon_decodes() {
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
            .expect("32x32.png must decode");
        assert_eq!((icon.width(), icon.height()), (32, 32));
    }
}
