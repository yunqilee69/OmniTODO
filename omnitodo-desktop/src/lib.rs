//! OmniTODO desktop shell (Tauri 2). All real logic lives in `omnitodo-core`;
//! this crate wires commands, events, tray, shortcuts and the MCP transports.
//!
//! NOTE: this crate is excluded from the root workspace and is compiled with
//! `cargo tauri dev|build` (it needs WebView system libraries). It has not been
//! built in the headless CI used for the core/CLI/MCP tests.

mod commands;
mod control;
mod deeplink;
mod mcp_cmds;
mod mcp_http;
mod shortcut;
mod state;
mod tray;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // Must be registered first: on Windows and Linux a deep link arrives as a
        // CLI argument to a freshly spawned process, and this plugin's callback is
        // what hands that URL to the already-running instance instead (the
        // deep-link plugin's own docs call this out).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            deeplink::register_on_open(app, &argv);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let state = tauri::async_runtime::block_on(state::AppState::new())?;
            let core = state.core.clone();
            let control_port = state.control_port;
            let control_token = state.control_token.clone();
            let app_handle = app.handle().clone();

            // Manage the state before spawning anything that reads it back with
            // `app.state::<AppState>()` — the reminder tick does, and it would
            // otherwise race this call and panic.
            app.manage(state);

            deeplink::register(&app_handle);

            // Control endpoint that external MCP instances call back into (§4.5).
            {
                let app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = control::serve(control_port, control_token, app).await {
                        eprintln!("control endpoint disabled: {e}");
                    }
                });
            }

            // Reminder + recurrence tick (§9.1).
            mcp_cmds::spawn_reminder_task(app_handle.clone(), core.clone());

            tray::build(&app_handle)?;
            // Best-effort: a taken accelerator must not abort startup.
            if let Err(e) = shortcut::register(&app_handle, "CmdOrCtrl+Shift+Space") {
                eprintln!("global shortcut unavailable: {e}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::task_create,
            commands::task_get,
            commands::task_list,
            commands::task_update,
            commands::task_complete,
            commands::task_uncomplete,
            commands::task_move,
            commands::task_bulk_update,
            commands::task_delete,
            commands::task_reorder,
            commands::task_add_subtask,
            commands::task_list_subtasks,
            commands::project_create,
            commands::project_list,
            commands::project_get,
            commands::project_update,
            commands::project_reorder,
            commands::project_delete,
            commands::project_find_similar,
            commands::tag_list,
            commands::tag_create,
            commands::tag_rename,
            commands::tag_merge,
            commands::tag_delete,
            commands::attachment_add_blob,
            commands::attachment_add_managed,
            commands::attachment_list,
            commands::attachment_open,
            commands::attachment_remove,
            commands::search_query,
            commands::quickadd_parse,
            commands::quickadd_commit,
            commands::settings_get,
            commands::settings_set,
            commands::report_summary,
            commands::reminder_due_now,
            commands::reminder_mark_fired,
            commands::reminder_snooze,
            commands::materialize_due,
            commands::calendar,
            commands::recurrence_canonical,
            commands::recurrence_preview,
            commands::import_run,
            commands::export_run,
            commands::app_version,
            commands::app_releases_url,
            mcp_cmds::mcp_status,
            mcp_cmds::reminder_missed,
            mcp_cmds::mcp_http_start,
            mcp_cmds::mcp_http_stop,
            mcp_cmds::mcp_copy_client_config,
            mcp_cmds::control_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OmniTODO");
}
