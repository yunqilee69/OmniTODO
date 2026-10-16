//! Tauri commands: thin wrappers over `omnitodo-core` (design §8.1).
//! Each maps 1:1 to a service call and carries no business logic.

use serde_json::Value;
use tauri::State;

use omnitodo_core::domain::*;
use omnitodo_core::error::ApiError;
use omnitodo_core::service::importexport::ExportFormat;
use omnitodo_core::service::quickadd::QuickAddDraft;
use omnitodo_core::service::recurrence::RecurrenceRule;
use omnitodo_core::service::report::{self, ReportSummary};
use omnitodo_core::service::reminder::ReminderHit;

use crate::state::AppState;

type R<T> = Result<T, ApiError>;

// -- tasks ------------------------------------------------------------------

#[tauri::command]
pub async fn task_create(state: State<'_, AppState>, input: CreateTaskInput) -> R<TaskDto> {
    Ok(state.core.create_task(input).await?)
}

#[tauri::command]
pub async fn task_get(state: State<'_, AppState>, id: String) -> R<TaskDto> {
    Ok(state.core.get_task(&id).await?)
}

#[tauri::command]
pub async fn task_list(state: State<'_, AppState>, filter: TaskFilter) -> R<Page<TaskDto>> {
    Ok(state.core.list_tasks(&filter).await?)
}

#[tauri::command]
pub async fn task_update(state: State<'_, AppState>, id: String, patch: TaskPatch) -> R<TaskDto> {
    Ok(state.core.update_task(&id, patch).await?)
}

#[tauri::command]
pub async fn task_complete(state: State<'_, AppState>, id: String) -> R<TaskDto> {
    Ok(state.core.complete_task(&id).await?)
}

#[tauri::command]
pub async fn task_uncomplete(state: State<'_, AppState>, id: String) -> R<TaskDto> {
    Ok(state.core.uncomplete_task(&id).await?)
}

#[tauri::command]
pub async fn task_move(
    state: State<'_, AppState>,
    id: String,
    project_id: Option<String>,
    parent_id: Option<String>,
    sort_order: Option<i64>,
) -> R<TaskDto> {
    Ok(state
        .core
        .move_task(&id, project_id.map(Some), parent_id.map(Some), sort_order)
        .await?)
}

#[tauri::command]
pub async fn task_bulk_update(
    state: State<'_, AppState>,
    ids: Vec<String>,
    patch: TaskPatch,
) -> R<u32> {
    Ok(state.core.bulk_update(&ids, &patch).await?)
}

#[tauri::command]
pub async fn task_delete(state: State<'_, AppState>, id: String) -> R<usize> {
    Ok(state.core.delete_task(&id).await?)
}

/// Persist a manual order for a dragged list (design §13.2).
#[tauri::command]
pub async fn task_reorder(state: State<'_, AppState>, ids: Vec<String>) -> R<()> {
    Ok(state.core.reorder_tasks(&ids).await?)
}

#[tauri::command]
pub async fn task_add_subtask(
    state: State<'_, AppState>,
    parent_id: String,
    input: CreateTaskInput,
) -> R<TaskDto> {
    Ok(state.core.add_subtask(&parent_id, input).await?)
}

#[tauri::command]
pub async fn task_list_subtasks(state: State<'_, AppState>, id: String) -> R<Vec<TaskDto>> {
    Ok(state.core.list_subtasks(&id).await?)
}

// -- projects ---------------------------------------------------------------

#[tauri::command]
pub async fn project_create(state: State<'_, AppState>, input: CreateProjectInput) -> R<ProjectDto> {
    Ok(state.core.create_project(input).await?)
}

#[tauri::command]
pub async fn project_list(state: State<'_, AppState>, include_archived: bool) -> R<Vec<ProjectDto>> {
    Ok(state.core.list_projects(include_archived).await?)
}

#[tauri::command]
pub async fn project_get(state: State<'_, AppState>, id: String) -> R<ProjectDto> {
    Ok(state.core.get_project(&id).await?)
}

#[tauri::command]
pub async fn project_update(
    state: State<'_, AppState>,
    id: String,
    patch: ProjectPatch,
) -> R<ProjectDto> {
    Ok(state.core.update_project(&id, patch).await?)
}

#[tauri::command]
pub async fn project_reorder(state: State<'_, AppState>, ids: Vec<String>) -> R<()> {
    Ok(state.core.reorder_projects(&ids).await?)
}

#[tauri::command]
pub async fn project_delete(state: State<'_, AppState>, id: String) -> R<usize> {
    Ok(state.core.delete_project(&id).await?)
}

#[tauri::command]
pub async fn project_find_similar(state: State<'_, AppState>, name: String) -> R<Vec<ProjectDto>> {
    Ok(state.core.find_similar_projects(&name).await?)
}

// -- sections ---------------------------------------------------------------

#[tauri::command]
pub async fn section_create(state: State<'_, AppState>, input: CreateSectionInput) -> R<SectionDto> {
    Ok(state.core.create_section(input).await?)
}

#[tauri::command]
pub async fn section_list(state: State<'_, AppState>, project_id: String) -> R<Vec<SectionDto>> {
    Ok(state.core.list_sections(&project_id).await?)
}

#[tauri::command]
pub async fn section_get(state: State<'_, AppState>, id: String) -> R<SectionDto> {
    Ok(state.core.get_section(&id).await?)
}

#[tauri::command]
pub async fn section_update(
    state: State<'_, AppState>,
    id: String,
    patch: SectionPatch,
) -> R<SectionDto> {
    Ok(state.core.update_section(&id, patch).await?)
}

#[tauri::command]
pub async fn section_reorder(state: State<'_, AppState>, ids: Vec<String>) -> R<()> {
    Ok(state.core.reorder_sections(&ids).await?)
}

/// `deleteTasks` decides whether the section's tasks go with it (Todoist's
/// behaviour) or are released into "no section" (the default). Either way the
/// count that comes back is the number of tasks affected.
#[tauri::command]
pub async fn section_delete(
    state: State<'_, AppState>,
    id: String,
    delete_tasks: Option<bool>,
) -> R<usize> {
    Ok(state.core.delete_section(&id, delete_tasks.unwrap_or(false)).await?)
}

// -- tags -------------------------------------------------------------------

#[tauri::command]
pub async fn tag_list(state: State<'_, AppState>) -> R<Vec<TagDto>> {
    Ok(state.core.list_tags().await?)
}

#[tauri::command]
pub async fn tag_create(state: State<'_, AppState>, name: String, color: Option<String>) -> R<TagDto> {
    Ok(state.core.create_tag(&name, color).await?)
}

#[tauri::command]
pub async fn tag_rename(state: State<'_, AppState>, id: String, name: String) -> R<()> {
    Ok(state.core.rename_tag(&id, &name).await?)
}

#[tauri::command]
pub async fn tag_merge(state: State<'_, AppState>, from: String, to: String) -> R<()> {
    Ok(state.core.merge_tags(&from, &to).await?)
}

#[tauri::command]
pub async fn tag_delete(state: State<'_, AppState>, id: String) -> R<()> {
    Ok(state.core.delete_tag(&id).await?)
}

// -- attachments ------------------------------------------------------------

#[tauri::command]
pub async fn attachment_add_blob(
    state: State<'_, AppState>,
    task_id: String,
    path: String,
) -> R<AttachmentDto> {
    Ok(state
        .core
        .add_blob_from_path(&task_id, std::path::Path::new(&path), None)
        .await?)
}

#[tauri::command]
pub async fn attachment_add_managed(
    state: State<'_, AppState>,
    task_id: String,
    path: String,
) -> R<AttachmentDto> {
    Ok(state
        .core
        .add_managed(&task_id, std::path::Path::new(&path))
        .await?)
}

#[tauri::command]
pub async fn attachment_list(state: State<'_, AppState>, task_id: String) -> R<Vec<AttachmentDto>> {
    Ok(state.core.list_attachments(&task_id).await?)
}

#[tauri::command]
pub async fn attachment_open(state: State<'_, AppState>, id: String) -> R<String> {
    Ok(state.core.attachment_open_path(&id).await?.display().to_string())
}

#[tauri::command]
pub async fn attachment_remove(state: State<'_, AppState>, id: String) -> R<()> {
    Ok(state.core.remove_attachment(&id).await?)
}

// -- search / quick add -----------------------------------------------------

#[tauri::command]
pub async fn search_query(
    state: State<'_, AppState>,
    query: String,
    filter: TaskFilter,
) -> R<Page<TaskDto>> {
    Ok(state.core.search(&query, &filter).await?)
}

#[tauri::command]
pub async fn quickadd_parse(state: State<'_, AppState>, text: String) -> R<QuickAddDraft> {
    Ok(state
        .core
        .quickadd_preview(&text, omnitodo_core::clock::now_ms())
        .await?)
}

#[tauri::command]
pub async fn quickadd_commit(
    state: State<'_, AppState>,
    draft: QuickAddDraft,
    project_id: Option<String>,
) -> R<TaskDto> {
    Ok(state.core.quickadd_commit(&draft, project_id).await?)
}

// -- recurrence -------------------------------------------------------------

/// Normalise a rule (canonical or shorthand) for display, e.g.
/// `每周一,三` -> `FREQ=WEEKLY;BYDAY=MO,WE`. Errors surface as `VALIDATION`.
#[tauri::command]
pub async fn recurrence_canonical(rule: String) -> R<String> {
    Ok(RecurrenceRule::parse(&rule)?.to_canonical())
}

/// Preview instants produced by a rule, for the detail panel's rule editor
/// (design §13.2). `anchor` is the series anchor — `due_at ?? start_at`.
#[tauri::command]
pub async fn recurrence_preview(
    rule: String,
    anchor: i64,
    from: i64,
    to: i64,
) -> R<Vec<i64>> {
    let parsed = RecurrenceRule::parse(&rule)?;
    Ok(parsed.expand(anchor, from, to, 50))
}

// -- settings / report / reminders / io -------------------------------------

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>, key: String) -> R<Option<Value>> {
    Ok(state.core.setting_get(&key).await?)
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, key: String, value: Value) -> R<()> {
    Ok(state.core.setting_set(&key, &value).await?)
}

#[tauri::command]
pub async fn report_summary(
    state: State<'_, AppState>,
    days: Option<i64>,
) -> R<ReportSummary> {
    let now = omnitodo_core::clock::now_ms();
    let from = now - days.unwrap_or(30) * 86_400_000;
    Ok(report::summary(&state.core, from, now, None, true).await?)
}

#[tauri::command]
pub async fn reminder_due_now(state: State<'_, AppState>) -> R<Vec<ReminderHit>> {
    Ok(state.core.reminders_due_now(omnitodo_core::clock::now_ms()).await?)
}

#[tauri::command]
pub async fn reminder_mark_fired(
    state: State<'_, AppState>,
    task_id: String,
    occurrence_at: i64,
) -> R<()> {
    Ok(state.core.mark_reminder_fired(&task_id, occurrence_at).await?)
}

/// Push a reminder into the future; returns the new reminder instant.
#[tauri::command]
pub async fn reminder_snooze(
    state: State<'_, AppState>,
    task_id: String,
    occurrence_at: Option<i64>,
    minutes: Option<i64>,
) -> R<i64> {
    Ok(state
        .core
        .snooze_reminder(&task_id, occurrence_at, minutes.unwrap_or(10))
        .await?)
}

#[tauri::command]
pub async fn materialize_due(state: State<'_, AppState>) -> R<usize> {
    Ok(state.core.materialize_due(omnitodo_core::clock::now_ms()).await?)
}

#[tauri::command]
pub async fn calendar(
    state: State<'_, AppState>,
    from: i64,
    to: i64,
    project_id: Option<String>,
) -> R<Vec<omnitodo_core::service::calendar::CalendarItemDto>> {
    Ok(state.core.calendar(from, to, project_id.as_deref()).await?)
}

#[tauri::command]
pub async fn import_run(
    state: State<'_, AppState>,
    content: String,
    format: String,
) -> R<usize> {
    use omnitodo_core::service::importexport::ImportFormat;
    let fmt = ImportFormat::parse(&format).ok_or_else(|| {
        omnitodo_core::CoreError::Validation(format!("unknown import format: {format}"))
    })?;
    Ok(state.core.import_run(&content, fmt).await?)
}

#[tauri::command]
pub async fn export_run(
    state: State<'_, AppState>,
    filter: TaskFilter,
    format: String,
) -> R<String> {
    let fmt = ExportFormat::parse(&format).unwrap_or(ExportFormat::Json);
    Ok(state.core.export_tasks(&filter, fmt).await?)
}

#[tauri::command]
pub async fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn app_releases_url(state: State<'_, AppState>) -> R<String> {
    let configured = state.core.setting_get("app.releases_url").await?;
    Ok(configured
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "https://github.com/yunqilee69/OmniTODO/releases".to_string()))
}
