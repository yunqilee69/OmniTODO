//! MCP-related commands and the reminder/materialisation tick (design §9.1, §11).

use serde_json::json;
use tauri::{AppHandle, State};

use omnitodo_core::error::ApiError;
use omnitodo_core::service::reminder;
use omnitodo_core::service::Core;

use crate::state::AppState;

type R<T> = Result<T, ApiError>;

#[tauri::command]
pub async fn mcp_status(state: State<'_, AppState>) -> R<serde_json::Value> {
    let http = state.http_server.lock().await;
    let running = http.is_some();
    // Report the port actually bound, not just the configured default.
    let port = http.as_ref().map(|h| h.port).unwrap_or(state.http_port);
    let bin = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(mcp_bin_name())))
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| mcp_bin_name().to_string());
    let write_enabled = state.mcp_write_enabled().await?;
    Ok(json!({
        "stdio": { "bin_path": bin, "always_available": true },
        "http": { "running": running, "port": port, "token": state.http_token },
        "control": { "port": state.control_port, "token": state.control_token },
        "write_enabled": write_enabled,
    }))
}

/// Reminders missed while the app was closed, drained on read (design §9.2).
///
/// The UI calls this on mount; the matching `reminder:catch_up` event fires
/// before the frontend's listener exists, so this is the reliable path.
#[tauri::command]
pub async fn reminder_missed(state: State<'_, AppState>) -> R<Vec<reminder::ReminderHit>> {
    Ok(std::mem::take(&mut *state.missed_reminders.lock().await))
}

#[tauri::command]
pub async fn mcp_http_start(
    app: AppHandle,
    state: State<'_, AppState>,
    port: Option<u16>,
) -> R<()> {
    let mut slot = state.http_server.lock().await;
    if slot.is_some() {
        return Ok(());
    }
    let port = port.unwrap_or(state.http_port);
    let write_enabled = state.mcp_write_enabled().await?;
    match crate::mcp_http::start(port, state.http_token.clone(), state.core.clone(), write_enabled, app)
        .await
    {
        Ok(handle) => {
            *slot = Some(handle);
            Ok(())
        }
        Err(e) => Err(ApiError {
            code: "HTTP_PORT".into(),
            message: format!("cannot bind 127.0.0.1:{port}: {e}"),
        }),
    }
}

#[tauri::command]
pub async fn mcp_http_stop(state: State<'_, AppState>) -> R<()> {
    let mut slot = state.http_server.lock().await;
    if let Some(handle) = slot.take() {
        handle.shutdown.notify_waiters();
    }
    Ok(())
}

/// Copy-ready MCP client config (design §11.1).
///
/// Carries the notify callback so assistant-driven writes refresh the UI without
/// polling (§4.5), and `--write` only when the user enabled write tools (§11.4).
#[tauri::command]
pub async fn mcp_copy_client_config(state: State<'_, AppState>) -> R<String> {
    let db = omnitodo_core::config::db_path();
    let mut args = vec![
        "--db".to_string(),
        db.display().to_string(),
        "--notify".to_string(),
        format!("http://127.0.0.1:{}/internal/notify", state.control_port),
        "--notify-token".to_string(),
        state.control_token.clone(),
    ];
    if state.mcp_write_enabled().await? {
        args.push("--write".to_string());
    }
    Ok(json!({
        "mcpServers": {
            "omnitodo": { "command": mcp_bin_name(), "args": args }
        }
    })
    .to_string())
}

/// Loopback control endpoint coordinates (design §4.5), surfaced in settings so
/// the user can wire up an external MCP client by hand.
#[tauri::command]
pub async fn control_config(state: State<'_, AppState>) -> R<crate::control::ControlConfig> {
    Ok(crate::control::ControlConfig {
        port: state.control_port,
        token: state.control_token.clone(),
    })
}

fn mcp_bin_name() -> &'static str {
    if cfg!(windows) {
        "omnitodo-mcp.exe"
    } else {
        "omnitodo-mcp"
    }
}

/// Reminder + recurrence materialisation tick, every 30 seconds (design §9.1).
///
/// Materialisation always runs — it is what keeps the completion/late-rate
/// statistics honest (design §5.5) — while the reminder *firing* honours the
/// `reminder.enabled` setting from the settings page.
pub fn spawn_reminder_task(app: AppHandle, core: Core) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(30));
        // Catch-up: aggregate reminders missed while the app was closed (§9.2).
        let now = omnitodo_core::clock::now_ms();
        if reminders_enabled(&core).await {
            if let Ok(missed) = core.reminders_catch_up(now - 24 * 3_600_000, now).await {
                if !missed.is_empty() {
                    notify_batch(&app, &missed);
                    // Park the list for the UI to pick up (see
                    // `AppState::missed_reminders` — this emit usually beats the
                    // webview's listener).
                    {
                        use tauri::Manager;
                        let state = app.state::<AppState>();
                        *state.missed_reminders.lock().await = missed.clone();
                    }
                    emit(&app, "reminder:catch_up", &missed);
                    // The aggregate notification *is* this occurrence's
                    // notification, so mark it fired (§9.1 "重启不重复通知").
                    // Without this the reminder is still inside `due_now`'s
                    // 60-second window on the first tick and the user gets a
                    // second, per-reminder toast for the same thing.
                    for hit in &missed {
                        let _ = core.mark_reminder_fired(&hit.task_id, hit.occurrence_at).await;
                    }
                }
            }
        }
        loop {
            ticker.tick().await;
            let now = omnitodo_core::clock::now_ms();
            let _ = core.materialize_due(now).await;
            if !reminders_enabled(&core).await {
                continue;
            }
            if let Ok(hits) = core.reminders_due_now(now).await {
                for hit in hits {
                    notify_one(&app, &hit);
                    emit(&app, "reminder:fired", &hit);
                    let _ = core.mark_reminder_fired(&hit.task_id, hit.occurrence_at).await;
                }
            }
        }
    });
}

/// Whether the user left reminders on (settings `reminder.enabled`, default on).
/// A read failure keeps them on: the setting is a convenience switch, not a
/// security boundary, and silently disabling reminders is the worse failure.
async fn reminders_enabled(core: &Core) -> bool {
    !matches!(
        core.setting_get("reminder.enabled").await,
        Ok(Some(serde_json::Value::Bool(false)))
    )
}

fn emit<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: &T) {
    use tauri::Emitter;
    let _ = app.emit(event, payload.clone());
}

/// Show one OS notification for a fired reminder (§16 P3: “到点弹通知”).
/// Failures are swallowed: on a headless X11 session (no notification daemon)
/// the in-app `reminder:fired` event is still the source of truth.
fn notify_one(app: &AppHandle, hit: &reminder::ReminderHit) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("OmniTODO")
        .body(hit.title.clone())
        .show();
}

/// One aggregated notification for reminders missed while the app was closed.
fn notify_batch(app: &AppHandle, hits: &[reminder::ReminderHit]) {
    use tauri_plugin_notification::NotificationExt;
    let body = match hits {
        [] => return,
        [one] => one.title.clone(),
        [first, rest @ ..] => format!("{} 等 {} 项提醒已到期", first.title, rest.len() + 1),
    };
    let _ = app.notification().builder().title("OmniTODO 错过的提醒").body(body).show();
}

