//! Deep links: `omnitodo://task/<id>` focuses a task, `omnitodo://projects` opens
//! the project list (design §9 "点击通知经 deep-link 聚焦到该任务", §11
//! `Resources / Prompts` 的 `omnitodo://projects`、`omnitodo://task/{id}`).
//!
//! Both the notification click and a cold start have to land here, so the URL
//! arrives either as `deep-link://new-url` or as the launch argument, and both go
//! through [`focus_from_url`] so the behaviour cannot drift apart.

use tauri::{AppHandle, Emitter, Manager};

/// Event the frontend listens on; the payload is a task id.
pub const FOCUS_TASK_EVENT: &str = "deeplink:focus-task";

/// What a deep link asks the UI to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLinkAction {
    /// Focus the task with this id.
    FocusTask(String),
    /// Open the project list.
    OpenProjects,
    /// Nothing recognisable; callers log and move on.
    Unhandled,
}

/// Parse one `omnitodo://` URL into an action.
///
/// Host and path are normalised because `omnitodo://task/<id>` and
/// `omnitodo:///task/<id>` both reach us depending on the platform and on
/// whether the OS rewrites the URL.
pub fn focus_from_url(url: &str) -> DeepLinkAction {
    let rest = match url.strip_prefix("omnitodo://") {
        Some(rest) => rest,
        // Not our scheme — the OS may hand over an unrelated URL on some
        // platforms' single-instance forwarding.
        None => return DeepLinkAction::Unhandled,
    };
    // Drop query/fragment, then any leading slashes.
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let path = rest.trim_start_matches('/');
    let (kind, arg) = match path.split_once('/') {
        Some((kind, arg)) => (kind, arg),
        None => (path, ""),
    };
    match kind {
        "task" if !arg.is_empty() => DeepLinkAction::FocusTask(arg.to_string()),
        "projects" => DeepLinkAction::OpenProjects,
        _ => DeepLinkAction::Unhandled,
    }
}

/// Register the handler and replay a URL the app was launched with.
///
/// Registration is best-effort: on Linux the scheme needs a `.desktop` entry that
/// was installed before the app ever ran, and that registration fails on a
/// development machine all the time. The app must still start.
pub fn register(app: &AppHandle) {
    use tauri_plugin_deep_link::DeepLinkExt;

    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            dispatch(&handle, url.as_str());
        }
    });

    if let Err(e) = app.deep_link().register_all() {
        eprintln!("deep-link scheme registration unavailable: {e}");
    }

    // Cold start: the URL that launched us is reported here rather than via the
    // event, because the listener above did not exist yet.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(Some(urls)) = handle.deep_link().get_current() {
            for url in urls {
                dispatch(&handle, url.as_str());
            }
        }
    });

    // Cold start on Windows/Linux: the URL arrives as a plain CLI argument in
    // this very process (single-instance lets a second launch forward instead).
    register_on_open(app, &std::env::args().collect::<Vec<_>>());
}

/// Handle a second launch's arguments, dispatching any `omnitodo://` URL in them.
///
/// This is the path Windows and Linux take: the OS starts a new process with the
/// URL as an argument, and single-instance hands those arguments here instead of
/// letting a duplicate app start. Non-URL arguments (flags, paths) are skipped.
pub fn register_on_open(app: &AppHandle, argv: &[String]) {
    for arg in argv {
        if arg.starts_with("omnitodo://") {
            dispatch(app, arg);
        }
    }
}

/// Turn a URL into a UI action and emit it.
fn dispatch(app: &AppHandle, url: &str) {
    // A deep link is also how the user gets the window back, so bring it
    // forward: otherwise the click appears to do nothing when the app is
    // minimised or behind another window.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    match focus_from_url(url) {
        DeepLinkAction::FocusTask(id) => {
            let _ = app.emit(FOCUS_TASK_EVENT, id);
        }
        DeepLinkAction::OpenProjects => {
            let _ = app.emit(FOCUS_TASK_EVENT, ());
        }
        DeepLinkAction::Unhandled => {
            eprintln!("deep-link ignored: {url}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_url_focuses_that_task() {
        assert_eq!(
            focus_from_url("omnitodo://task/abc-123"),
            DeepLinkAction::FocusTask("abc-123".into())
        );
    }

    #[test]
    fn project_url_opens_projects() {
        assert_eq!(focus_from_url("omnitodo://projects"), DeepLinkAction::OpenProjects);
    }

    #[test]
    fn tolerates_the_forms_different_platforms_produce() {
        // Platforms differ on whether the host part keeps its slashes, and the
        // OS may append a query string. All must resolve to the same action.
        for url in [
            "omnitodo://task/abc-123",
            "omnitodo:///task/abc-123",
            "omnitodo://task/abc-123?src=notification",
            "omnitodo://task/abc-123#frag",
        ] {
            assert_eq!(
                focus_from_url(url),
                DeepLinkAction::FocusTask("abc-123".into()),
                "failed for {url}"
            );
        }
    }

    #[test]
    fn unknown_and_foreign_urls_are_ignored() {
        // Single-instance forwarding can hand us a URL that is not ours.
        assert_eq!(focus_from_url("https://example.com"), DeepLinkAction::Unhandled);
        assert_eq!(focus_from_url("omnitodo://nope"), DeepLinkAction::Unhandled);
        // A task link with no id is not actionable.
        assert_eq!(focus_from_url("omnitodo://task/"), DeepLinkAction::Unhandled);
    }
}
