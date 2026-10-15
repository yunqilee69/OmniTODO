//! End-to-end tests for `omnitodo-core` against a real (in-memory) SQLite DB
//! exercising the same code paths the desktop app and MCP server use.

use std::path::PathBuf;

use omnitodo_core::clock::now_ms;
use omnitodo_core::domain::*;
use omnitodo_core::service::importexport::{
    import_todotxt, ExportFormat, ImportFormat,
};
use chrono::Timelike;
use omnitodo_core::service::quickadd::{parse_when, QuickAddParser};
use omnitodo_core::service::recurrence::RecurrenceRule;
use omnitodo_core::service::endpoint;
use omnitodo_core::service::{report, Core};

const DAY: i64 = 86_400_000;

async fn core() -> (Core, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let root: PathBuf = dir.path().join("attachments");
    let core = Core::open_in_memory(root).await.unwrap();
    (core, dir)
}

// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_crud_and_stats() {
    let (core, _d) = core().await;
    let p = core
        .create_project(CreateProjectInput {
            name: " Work ".into(),
            color: Some("#ff0000".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(p.name, "Work");

    core.create_task(CreateTaskInput {
        title: "open one".into(),
        project_id: Some(p.id.clone()),
        ..Default::default()
    })
    .await
    .unwrap();
    let done = core
        .create_task(CreateTaskInput {
            title: "done one".into(),
            project_id: Some(p.id.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    core.complete_task(&done.id).await.unwrap();

    let got = core.get_project(&p.id).await.unwrap();
    let stats = got.stats.unwrap();
    assert_eq!(stats.open, 1);
    assert_eq!(stats.completed, 1);

    let list = core.list_projects(false).await.unwrap();
    assert_eq!(list.len(), 1);

    // Archive hides it from the default listing.
    core.archive_project(&p.id, true).await.unwrap();
    assert!(core.list_projects(false).await.unwrap().is_empty());
    assert_eq!(core.list_projects(true).await.unwrap().len(), 1);
}

#[tokio::test]
async fn task_crud_filter_and_sort() {
    let (core, _d) = core().await;
    let now = now_ms();
    core.create_task(CreateTaskInput {
        title: "low".into(),
        priority: Some(Priority::Low),
        due_at: Some(now + 3 * DAY),
        ..Default::default()
    })
    .await
    .unwrap();
    core.create_task(CreateTaskInput {
        title: "urgent".into(),
        priority: Some(Priority::Urgent),
        due_at: Some(now + DAY),
        ..Default::default()
    })
    .await
    .unwrap();

    // Priority sort puts urgent first.
    let page = core
        .list_tasks(&TaskFilter {
            sort: Sort::PriorityDesc,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.items[0].title, "urgent");
    assert_eq!(page.total, 2);

    // Due-window filter.
    let page = core
        .list_tasks(&TaskFilter {
            due_before: Some(now + 2 * DAY),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].title, "urgent");

    // Priority filter.
    let page = core
        .list_tasks(&TaskFilter {
            priorities: Some(vec![Priority::Low]),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
}

#[tokio::test]
async fn manual_reorder_tasks() {
    let (core, _d) = core().await;
    let mut ids = vec![];
    for title in ["a", "b", "c"] {
        let t = core
            .create_task(CreateTaskInput {
                title: title.into(),
                ..Default::default()
            })
            .await
            .unwrap();
        ids.push(t.id);
    }

    // Sort::Manual reads back exactly the order the caller passed.
    assert_eq!(
        manual_order(&core, &[ids[2].clone(), ids[1].clone(), ids[0].clone()]).await,
        ["c", "b", "a"]
    );
    assert_eq!(
        manual_order(&core, &[ids[1].clone(), ids[0].clone(), ids[2].clone()]).await,
        ["b", "a", "c"]
    );

    // Unknown and soft-deleted ids are skipped without disturbing the order of
    // the ids that do exist.
    let ghost = core
        .create_task(CreateTaskInput {
            title: "ghost".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    core.delete_task(&ghost.id).await.unwrap();
    assert_eq!(
        manual_order(
            &core,
            &[
                ghost.id.clone(),
                "does-not-exist".into(),
                ids[1].clone(),
                ids[2].clone(),
                ids[0].clone(),
            ]
        )
        .await,
        ["b", "c", "a"]
    );

    // Reordering only touches sort_order; the task keeps its identity.
    assert!(core.get_task(&ids[0]).await.unwrap().version > 1);
}

/// Apply `reorder_tasks` then read the list back under `Sort::Manual`.
async fn manual_order(core: &Core, ids: &[Id]) -> Vec<String> {
    core.reorder_tasks(ids).await.unwrap();
    core.list_tasks(&TaskFilter {
        sort: Sort::Manual,
        ..Default::default()
    })
    .await
    .unwrap()
    .items
    .iter()
    .map(|t| t.title.clone())
    .collect()
}

#[tokio::test]
async fn tags_and_fulltext_search() {
    let (core, _d) = core().await;
    core.create_task(CreateTaskInput {
        title: "评审设计稿".into(),
        tag_names: vec!["设计".into(), "工作".into()],
        ..Default::default()
    })
    .await
    .unwrap();
    core.create_task(CreateTaskInput {
        title: "buy milk".into(),
        tag_names: vec!["life".into()],
        ..Default::default()
    })
    .await
    .unwrap();

    let tags = core.list_tags().await.unwrap();
    assert_eq!(tags.len(), 3);
    let design = tags.iter().find(|t| t.name == "设计").unwrap();
    assert_eq!(design.count, 1);

    // >= 3 chars -> FTS path.
    let page = core.search("设计稿", &TaskFilter::default()).await.unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].title, "评审设计稿");

    // < 3 chars -> LIKE fallback.
    let page = core.search("报", &TaskFilter::default()).await.unwrap();
    assert!(page.items.is_empty());

    // Tag search by name.
    let page = core.search("life", &TaskFilter::default()).await.unwrap();
    assert_eq!(page.items.len(), 1);

    // Filter by tag id.
    let life_id = tags.iter().find(|t| t.name == "life").unwrap().id.clone();
    let page = core
        .list_tasks(&TaskFilter {
            tag_ids: Some(vec![life_id]),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].title, "buy milk");
}

#[tokio::test]
async fn subtasks_depth_and_listing() {
    let (core, _d) = core().await;
    let root = core
        .create_task(CreateTaskInput {
            title: "root".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let child = core
        .add_subtask(
            &root.id,
            CreateTaskInput {
                title: "child".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(child.parent_id.as_deref(), Some(root.id.as_str()));

    let grand = core
        .add_subtask(
            &child.id,
            CreateTaskInput {
                title: "grand".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let subs = core.list_subtasks(&root.id).await.unwrap();
    assert_eq!(subs.len(), 2);

    // `has_subtasks` flags exactly the tasks with a child, so the list knows
    // which rows get an expand affordance.
    assert!(core.get_task(&root.id).await.unwrap().has_subtasks);
    assert!(core.get_task(&child.id).await.unwrap().has_subtasks);
    assert!(!core.get_task(&grand.id).await.unwrap().has_subtasks);
    // Same flag through the list path...
    let listed = core
        .list_tasks(&TaskFilter {
            root_only: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(listed.items[0].has_subtasks);
    // ...and the subtree path (child has a child, grand is a leaf).
    let by_id: std::collections::HashMap<_, _> =
        subs.iter().map(|s| (s.id.clone(), s.has_subtasks)).collect();
    assert!(by_id[&child.id]);
    assert!(!by_id[&grand.id]);

    // root_only filter excludes descendants.
    let page = core
        .list_tasks(&TaskFilter {
            root_only: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);

    // Cannot reparent a node under its own descendant.
    let err = core
        .move_task(&root.id, None, Some(Some(grand.id.clone())), None)
        .await
        .unwrap_err();
    assert!(format!("{err}").contains("descendant"));
}

#[tokio::test]
async fn subtask_progress_rolls_up_the_whole_subtree() {
    let (core, _d) = core().await;
    let root = core
        .create_task(CreateTaskInput {
            title: "root".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let child = core
        .add_subtask(
            &root.id,
            CreateTaskInput {
                title: "child".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let grand = core
        .add_subtask(
            &child.id,
            CreateTaskInput {
                title: "grand".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // The row shows counts for the branch expanding reveals, not just the
    // direct children: root answers for both of its descendants.
    let dto = core.get_task(&root.id).await.unwrap();
    assert_eq!((dto.subtask_done, dto.subtask_total), (0, 2));
    assert_eq!(core.get_task(&child.id).await.unwrap().subtask_total, 1);
    // A leaf reports zero and draws no progress line.
    let leaf = core.get_task(&grand.id).await.unwrap();
    assert_eq!((leaf.subtask_done, leaf.subtask_total), (0, 0));
    assert!(!leaf.has_subtasks);

    // Ticking a grandchild moves every ancestor's counter by one.
    core.complete_task(&grand.id).await.unwrap();
    let dto = core.get_task(&root.id).await.unwrap();
    assert_eq!((dto.subtask_done, dto.subtask_total), (1, 2));
    assert_eq!(core.get_task(&child.id).await.unwrap().subtask_done, 1);

    // A cancelled child reads as ticked, the same rule the row checkbox uses,
    // so the parent can still reach 2/2.
    core.update_task(
        &child.id,
        TaskPatch {
            status: Some(Status::Cancelled),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let dto = core.get_task(&root.id).await.unwrap();
    assert_eq!((dto.subtask_done, dto.subtask_total), (2, 2));

    // The list path agrees with the single-task path.
    let listed = core
        .list_tasks(&TaskFilter {
            root_only: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        (listed.items[0].subtask_done, listed.items[0].subtask_total),
        (2, 2)
    );
    // ...and so does the subtree path.
    let subs = core.list_subtasks(&root.id).await.unwrap();
    let by_id: std::collections::HashMap<_, _> =
        subs.iter().map(|s| (s.id.clone(), s.subtask_total)).collect();
    assert_eq!(by_id[&child.id], 1);
    assert_eq!(by_id[&grand.id], 0);

    // Soft-deleting a subtask drops it from the roll-up.
    core.delete_task(&grand.id).await.unwrap();
    let dto = core.get_task(&root.id).await.unwrap();
    assert_eq!((dto.subtask_done, dto.subtask_total), (1, 1));
}

#[tokio::test]
async fn delete_project_cascades_to_tasks() {
    let (core, _d) = core().await;
    let p = core
        .create_project(CreateProjectInput {
            name: "P".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let t = core
        .create_task(CreateTaskInput {
            title: "t".into(),
            project_id: Some(p.id.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    let sub = core
        .add_subtask(
            &t.id,
            CreateTaskInput {
                title: "sub".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let n = core.delete_project(&p.id).await.unwrap();
    assert_eq!(n, 2);
    assert!(core.get_task(&t.id).await.is_err());
    assert!(core.get_task(&sub.id).await.is_err());
    assert!(core.get_project(&p.id).await.is_err());
    // Gone from search too.
    assert_eq!(core.search("t", &TaskFilter::default()).await.unwrap().total, 0);
}

#[tokio::test]
async fn delete_task_cascades_subtree() {
    let (core, _d) = core().await;
    let root = core
        .create_task(CreateTaskInput {
            title: "root".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let c1 = core
        .add_subtask(&root.id, CreateTaskInput { title: "c1".into(), ..Default::default() })
        .await
        .unwrap();
    let c2 = core
        .add_subtask(&c1.id, CreateTaskInput { title: "c2".into(), ..Default::default() })
        .await
        .unwrap();
    let n = core.delete_task(&root.id).await.unwrap();
    assert_eq!(n, 3);
    assert!(core.get_task(&c2.id).await.is_err());
}

#[tokio::test]
async fn attachments_blob_managed_and_gc() {
    let (core, _d) = core().await;
    let t = core
        .create_task(CreateTaskInput { title: "t".into(), ..Default::default() })
        .await
        .unwrap();

    // Blob: stored in DB, round-trips bytes.
    let a1 = core
        .add_blob(&t.id, "note.txt", b"hello world", Some("text/plain".into()))
        .await
        .unwrap();
    assert_eq!(a1.storage_kind, StorageKind::Blob);
    assert_eq!(core.attachment_data(&a1.id).await.unwrap(), b"hello world");
    assert_eq!(a1.sha256.as_deref().unwrap().len(), 64);

    // Managed: file lands under <data_dir>/attachments and is content-addressed.
    let src = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(src.path(), b"managed payload").unwrap();
    let a2 = core.add_managed(&t.id, src.path()).await.unwrap();
    assert_eq!(a2.storage_kind, StorageKind::Managed);
    assert_eq!(core.attachment_data(&a2.id).await.unwrap(), b"managed payload");
    assert_eq!(core.check_missing(&t.id).await.unwrap().len(), 0);

    // Task detail reports attachments.
    let dto = core.get_task(&t.id).await.unwrap();
    assert!(dto.has_attachments);

    // Deleting the task soft-deletes attachments but leaves the managed file.
    core.delete_task(&t.id).await.unwrap();
    let managed = core
        .attachment_open_path(&a2.id)
        .await;
    assert!(managed.is_err()); // row now soft-deleted -> NotFound

    // GC removes the orphaned managed file.
    let removed = core.gc_attachments().await.unwrap();
    assert_eq!(removed, 1);
}

#[tokio::test]
async fn attachments_blob_size_limit() {
    let (core, _d) = core().await;
    let t = core
        .create_task(CreateTaskInput { title: "t".into(), ..Default::default() })
        .await
        .unwrap();
    let big = vec![0u8; 9 * 1024 * 1024];
    let err = core.add_blob(&t.id, "big.bin", &big, None).await.unwrap_err();
    assert!(format!("{err}").contains("blob limit"));
}

// ---------------------------------------------------------------------------
// recurrence
// ---------------------------------------------------------------------------

#[test]
fn recurrence_expand_daily() {
    let rule = RecurrenceRule::parse("FREQ=DAILY;INTERVAL=2").unwrap();
    let anchor = 0; // 1970-01-01T00:00:00Z
    let hits = rule.expand(anchor, 0, 6 * DAY, 100);
    // days 0,2,4,6
    assert_eq!(hits, vec![0, 2 * DAY, 4 * DAY, 6 * DAY]);
}

#[test]
fn recurrence_weekly_byday() {
    // 1970-01-01 was a Thursday; weekly on MO,WE,FR.
    let rule = RecurrenceRule::parse("FREQ=WEEKLY;BYDAY=MO,WE,FR").unwrap();
    let anchor = 0;
    let hits = rule.expand(anchor, 0, 8 * DAY, 100);
    // 1970-01-01 Thu(anchor), Fri 01-02, Mon 01-05, Wed 01-07, Fri 01-09
    assert_eq!(
        hits,
        vec![0, DAY, 4 * DAY, 6 * DAY, 8 * DAY]
    );
}

#[test]
fn recurrence_shorthand_and_canonical() {
    let rule = RecurrenceRule::parse("每天").unwrap();
    assert_eq!(rule.to_canonical(), "FREQ=DAILY");
    let rule = RecurrenceRule::parse("每周一,三,五").unwrap();
    assert_eq!(rule.to_canonical(), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
}

#[test]
fn recurrence_monthly_clamps_short_months() {
    // 31st of every month: February clamps to 28 (1970 not a leap year).
    let rule = RecurrenceRule::parse("FREQ=MONTHLY;BYMONTHDAY=31").unwrap();
    // anchor 1970-01-31
    let anchor = chrono::NaiveDate::from_ymd_opt(1970, 1, 31)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let to = chrono::NaiveDate::from_ymd_opt(1970, 3, 31)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let hits = rule.expand(anchor, anchor, to, 100);
    assert_eq!(hits.len(), 3); // Jan 31, Feb 28, Mar 31
}

#[tokio::test]
async fn materialize_due_is_idempotent() {
    let (core, _d) = core().await;
    let anchor_ms = now_ms() - 3 * DAY;
    let t = core
        .create_task(CreateTaskInput {
            title: "daily standup".into(),
            due_at: Some(anchor_ms),
            recurrence_rule: Some("FREQ=DAILY".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(t.series_id.is_some());

    let n1 = core.materialize_due(now_ms()).await.unwrap();
    assert!(n1 >= 3, "expected ~3 occurrences, got {n1}");
    let n2 = core.materialize_due(now_ms()).await.unwrap();
    assert_eq!(n2, 0, "second run must not duplicate");

    let all = core
        .list_tasks(&TaskFilter {
            limit: Some(100),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(all.total as usize, n1 + 1); // anchor + materialised
}

#[tokio::test]
async fn recurrence_requires_anchor() {
    let (core, _d) = core().await;
    let err = core
        .create_task(CreateTaskInput {
            title: "no anchor".into(),
            recurrence_rule: Some("FREQ=DAILY".into()),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert!(format!("{err}").contains("recurrence requires"));
}

#[tokio::test]
async fn calendar_merges_materialized_and_virtual() {
    let (core, _d) = core().await;
    // A daily series anchored 2 days ago: 3 occurrences due so far.
    let anchor = now_ms() - 2 * DAY;
    let created = core
        .create_task(CreateTaskInput {
            title: "standup".into(),
            due_at: Some(anchor),
            recurrence_rule: Some("FREQ=DAILY".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let series = created.series_id.clone().unwrap();

    // Nothing beyond the anchor exists yet.
    let virtual_only = core.expand_series(&series, anchor, anchor + 5 * DAY).await.unwrap();
    assert_eq!(virtual_only.iter().filter(|o| !o.materialized).count(), 5);
    assert_eq!(virtual_only.iter().filter(|o| o.materialized).count(), 1);

    // Materialise the past occurrences.
    core.materialize_due(now_ms()).await.unwrap();
    let expanded = core.expand_series(&series, anchor, anchor + 5 * DAY).await.unwrap();
    assert_eq!(expanded.iter().filter(|o| o.materialized).count(), 3);
    // Future ones remain virtual.
    assert_eq!(expanded.iter().filter(|o| !o.materialized).count(), 3);
    // No duplicate timestamps.
    let mut times: Vec<i64> = expanded.iter().map(|o| o.occurrence_at).collect();
    let len = times.len();
    times.sort_unstable();
    times.dedup();
    assert_eq!(times.len(), len);

    // Calendar window: past materialised + future virtual, ordered.
    let items = core.calendar(anchor, anchor + 5 * DAY).await.unwrap();
    assert!(items.iter().any(|i| i.virtual_occurrence && i.task_id.is_none()));
    assert!(items.iter().any(|i| !i.virtual_occurrence && i.task_id.is_some()));
    for i in 1..items.len() {
        let prev = items[i - 1].due_at.unwrap();
        let cur = items[i].due_at.unwrap();
        assert!(prev <= cur, "calendar items must be ordered");
    }
}

// ---------------------------------------------------------------------------
// reminders
// ---------------------------------------------------------------------------

#[tokio::test]
async fn reminders_due_and_fired_dedup() {
    let (core, _d) = core().await;
    let now = now_ms();
    let t = core
        .create_task(CreateTaskInput {
            title: "call".into(),
            due_at: Some(now + 30_000),
            remind_enabled: Some(true),
            remind_offset_min: Some(5),
            ..Default::default()
        })
        .await
        .unwrap();
    // remind time = due - 5min = now - 270s -> within the last minute? no.
    // Move due so the reminder is due now.
    core.update_task(
        &t.id,
        TaskPatch {
            due_at: Some(now + 60_000),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let hits = core.reminders_catch_up(now - 5 * 60_000, now + 120_000).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "call");

    core.mark_reminder_fired(&hits[0].task_id, hits[0].occurrence_at)
        .await
        .unwrap();
    let hits2 = core.reminders_catch_up(now - 5 * 60_000, now + 120_000).await.unwrap();
    assert!(hits2.is_empty(), "fired reminder must not repeat");
}

#[tokio::test]
async fn snooze_rearms_and_clears_the_fired_marker() {
    let (core, _d) = core().await;
    let now = now_ms();
    let t = core
        .create_task(CreateTaskInput {
            title: "stand up".into(),
            due_at: Some(now + 30_000),
            remind_enabled: Some(true),
            remind_offset_min: Some(1),
            ..Default::default()
        })
        .await
        .unwrap();

    // The reminder is due; fire it so de-duplication would suppress a repeat.
    let hits = core.reminders_catch_up(now - 60_000, now + 120_000).await.unwrap();
    assert_eq!(hits.len(), 1);
    let occurrence_at = hits[0].occurrence_at;
    core.mark_reminder_fired(&t.id, occurrence_at).await.unwrap();
    assert!(core
        .reminders_catch_up(now - 60_000, now + 120_000)
        .await
        .unwrap()
        .is_empty());

    // Snoozing re-arms it 10 minutes out and clears the fired marker so the
    // second shot is not deduplicated away.
    let new_at = core.snooze_reminder(&t.id, Some(occurrence_at), 10).await.unwrap();
    assert!((new_at - (now + 10 * 60_000)).abs() < 5_000);
    assert!(
        core.reminders_due_now(now).await.unwrap().is_empty(),
        "snoozed reminder must not fire immediately"
    );
    let later = core.reminders_catch_up(new_at - 1_000, new_at + 1_000).await.unwrap();
    assert_eq!(later.len(), 1, "snoozed reminder fires at its new time");
    assert_eq!(later[0].when, new_at);

    // Out-of-range windows are rejected.
    assert!(core.snooze_reminder(&t.id, None, 0).await.is_err());
    assert!(core.snooze_reminder(&t.id, None, 20_000).await.is_err());
}

// ---------------------------------------------------------------------------
// quick add
// ---------------------------------------------------------------------------

#[test]
fn quickadd_parses_all_tokens() {
    let now = chrono::NaiveDate::from_ymd_opt(2026, 10, 12)
        .unwrap()
        .and_hms_opt(9, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let d = QuickAddParser::parse("写周报 !高 @工作 #OmniTODO ^明天 ~30m ::重点", now);
    assert_eq!(d.title, "写周报");
    assert_eq!(d.priority, Some(Priority::High));
    assert_eq!(d.tag_names, vec!["工作".to_string()]);
    assert_eq!(d.project_name.as_deref(), Some("OmniTODO"));
    assert_eq!(d.remind_offset_min, Some(30));
    assert_eq!(d.description.as_deref(), Some("重点"));
    // 明天 = 2026-10-13, all-day -> UTC midnight.
    let expected = chrono::NaiveDate::from_ymd_opt(2026, 10, 13)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    assert_eq!(d.due_at, Some(expected));
    assert!(d.all_day);
}

#[test]
fn quickadd_all_day_is_utc_midnight_and_time_clears_flag() {
    let now = chrono::NaiveDate::from_ymd_opt(2026, 10, 12)
        .unwrap()
        .and_hms_opt(9, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let d = QuickAddParser::parse("x ^2026-10-20 18:00", now);
    assert!(!d.all_day);
    let expected = chrono::NaiveDate::from_ymd_opt(2026, 10, 20)
        .unwrap()
        .and_hms_opt(18, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    assert_eq!(d.due_at, Some(expected));
}

#[tokio::test]
async fn quickadd_commit_resolves_project() {
    let (core, _d) = core().await;
    let p = core
        .create_project(CreateProjectInput { name: "OmniTODO".into(), ..Default::default() })
        .await
        .unwrap();
    let now = now_ms();

    // Exact match: no picker needed.
    let draft = core.quickadd_preview("fix bug #OmniTODO", now).await.unwrap();
    assert!(!draft.needs_project_choice);
    assert_eq!(draft.project_candidates.len(), 1);
    let dto = core
        .quickadd_commit(&draft, Some(p.id.clone()))
        .await
        .unwrap();
    assert_eq!(dto.project_id.as_deref(), Some(p.id.as_str()));

    // Unknown name: picker required, no silent creation.
    let draft = core.quickadd_preview("something #Nope", now).await.unwrap();
    assert!(draft.needs_project_choice);
    assert!(draft.project_candidates.is_empty());
    // Commit without a choice -> Inbox.
    let dto = core.quickadd_commit(&draft, None).await.unwrap();
    assert!(dto.project_id.is_none());
}

// ---------------------------------------------------------------------------
// completion / report / import-export / maintenance
// ---------------------------------------------------------------------------

#[tokio::test]
async fn completion_upsert_avoids_double_count() {
    let (core, _d) = core().await;
    let t = core
        .create_task(CreateTaskInput { title: "t".into(), ..Default::default() })
        .await
        .unwrap();
    core.complete_task(&t.id).await.unwrap();
    core.uncomplete_task(&t.id).await.unwrap();
    core.complete_task(&t.id).await.unwrap();

    let now = now_ms();
    let s = report::summary(&core, now - DAY, now + DAY, None, true).await.unwrap();
    assert_eq!(s.completed, 1, "re-completion must not inflate counts");
}

#[tokio::test]
async fn report_summary_buckets() {
    let (core, _d) = core().await;
    let p = core
        .create_project(CreateProjectInput { name: "Work".into(), ..Default::default() })
        .await
        .unwrap();
    let overdue = core
        .create_task(CreateTaskInput {
            title: "late".into(),
            project_id: Some(p.id.clone()),
            due_at: Some(now_ms() - DAY),
            ..Default::default()
        })
        .await
        .unwrap();
    let t2 = core
        .create_task(CreateTaskInput {
            title: "soon".into(),
            project_id: Some(p.id.clone()),
            due_at: Some(now_ms() + DAY),
            ..Default::default()
        })
        .await
        .unwrap();
    core.complete_task(&t2.id).await.unwrap();

    let now = now_ms();
    let s = report::summary(&core, now - DAY, now + DAY, None, true).await.unwrap();
    assert_eq!(s.total, 2);
    assert_eq!(s.completed, 1);
    assert_eq!(s.overdue, 1);
    assert_eq!(s.due_soon, 0); // "late" is overdue, "soon" is done
    assert_eq!(s.overdue_list.len(), 1);
    assert_eq!(s.overdue_list[0].id, overdue.id);
    assert!(s.by_project.iter().any(|b| b.key == "Work" && b.overdue == 1));
    assert_eq!(s.throughput.len(), 1);
}

/// `completed` is a snapshot of the live task set; the throughput window is a
/// separate dataset. Both must be reported, and a soft-deleted task must not
/// keep inflating the window.
#[tokio::test]
async fn report_summary_separates_snapshot_from_window() {
    let (core, _d) = core().await;
    let kept = core
        .create_task(CreateTaskInput { title: "kept".into(), ..Default::default() })
        .await
        .unwrap();
    let removed = core
        .create_task(CreateTaskInput { title: "removed".into(), ..Default::default() })
        .await
        .unwrap();
    core.complete_task(&kept.id).await.unwrap();
    core.complete_task(&removed.id).await.unwrap();
    core.delete_task(&removed.id).await.unwrap();

    let now = now_ms();
    let s = report::summary(&core, now - DAY, now + DAY, None, true).await.unwrap();

    assert_eq!(s.completed, 1, "only the live done task is a snapshot completion");
    assert_eq!(s.completed_in_window, 1);
    let summed: i64 = s.throughput.iter().map(|(_, n)| n).sum();
    assert_eq!(
        summed, s.completed_in_window,
        "throughput is a breakdown of completed_in_window"
    );

    // Widening the window past the completion leaves the snapshot alone.
    let outside = report::summary(&core, now + DAY, now + 2 * DAY, None, true).await.unwrap();
    assert_eq!(outside.completed, 1, "snapshot ignores the window");
    assert_eq!(outside.completed_in_window, 0);
    assert!(outside.throughput.is_empty());
}

#[tokio::test]
async fn import_export_roundtrip() {
    let (core, _d) = core().await;
    let md = "- [ ] write report #work\n- [x] ship it #work\nnot a task\n";
    assert_eq!(core.import_run(md, ImportFormat::Markdown).await.unwrap(), 2);

    // `+project` names a project; the parser keeps the name, the import resolves it.
    core.create_project(CreateProjectInput { name: "家务".into(), ..Default::default() })
        .await
        .unwrap();
    let txt = "(A) 2026-10-20 pay bills @finance +家务\nplain task\n";
    let rows = import_todotxt(txt);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].input.priority, Some(Priority::Urgent));
    assert_eq!(rows[0].input.project_name.as_deref(), Some("家务"));
    assert!(!rows[0].input.title.contains("+家务"), "project token leaves the title");
    assert_eq!(core.import_run(txt, ImportFormat::TodoTxt).await.unwrap(), 2);

    let json = core
        .export_tasks(
            &TaskFilter {
                include_completed: true,
                limit: Some(100),
                ..Default::default()
            },
            ExportFormat::Json,
        )
        .await
        .unwrap();
    assert!(json.contains("write report"));
    let csv = core
        .export_tasks(
            &TaskFilter { include_completed: true, limit: Some(100), ..Default::default() },
            ExportFormat::Csv,
        )
        .await
        .unwrap();
    assert!(csv.starts_with("id,title,status"));
    let mdout = core
        .export_tasks(
            &TaskFilter { include_completed: true, limit: Some(100), ..Default::default() },
            ExportFormat::Markdown,
        )
        .await
        .unwrap();
    assert!(mdout.contains("- [x] ship it"));
}

#[tokio::test]
async fn import_todoist_json_keeps_projects_dates_and_subtasks() {
    let (core, _d) = core().await;
    let json = r#"{
      "projects": [{ "id": "p1", "name": "工作" }],
      "items": [
        { "id": "t1", "content": "整理季度汇报", "project_id": "p1", "priority": 4,
          "labels": ["汇报"], "description": "按 §13 写",
          "due": { "date": "2026-10-20" } },
        { "id": "t2", "content": "找数据", "parent_id": "t1", "project_id": "p1" },
        { "id": "t3", "content": "开会", "due": { "datetime": "2026-10-21T09:30:00Z" } },
        { "id": "t4", "content": "已完成的旧事", "checked": true, "priority": 2 }
      ]
    }"#;
    assert_eq!(core.import_run(json, ImportFormat::TodoistJson).await.unwrap(), 4);

    // The referenced project was created on demand and the tasks landed in it.
    let project = core.resolve_project_id("工作").await.unwrap();
    let in_project = core
        .list_tasks(&TaskFilter {
            project_ids: Some(vec![project.clone()]),
            include_completed: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(in_project.total, 2);

    let parent = in_project.items.iter().find(|t| t.title == "整理季度汇报").unwrap();
    assert_eq!(parent.priority, Priority::Urgent);
    assert_eq!(parent.tags, vec!["汇报".to_string()]);
    assert_eq!(parent.description.as_deref(), Some("按 §13 写"));
    assert!(parent.all_day, "a bare due.date is an all-day task");
    assert_eq!(parent.due_at.map(|d| d % DAY), Some(0));

    // The child was re-parented onto the newly created parent.
    let kids = core.list_subtasks(&parent.id).await.unwrap();
    assert_eq!(kids.len(), 1);
    assert_eq!(kids[0].title, "找数据");

    let timed = core
        .list_tasks(&TaskFilter { search_text: None, include_completed: true, ..Default::default() })
        .await
        .unwrap()
        .items
        .into_iter()
        .find(|t| t.title == "开会")
        .unwrap();
    assert!(!timed.all_day, "due.datetime is an instant");

    let old = core
        .list_tasks(&TaskFilter { include_completed: true, ..Default::default() })
        .await
        .unwrap()
        .items
        .into_iter()
        .find(|t| t.title == "已完成的旧事")
        .unwrap();
    assert_eq!(old.status, Status::Done);

    // Malformed input is rejected instead of importing nothing quietly.
    let err = core.import_run("{\"nope\": 1}", ImportFormat::TodoistJson).await.unwrap_err();
    assert_eq!(err.code(), "VALIDATION");
}

#[tokio::test]
async fn maintenance_prunes_and_rebuilds() {
    let (core, _d) = core().await;
    core.create_task(CreateTaskInput { title: "a".into(), ..Default::default() })
        .await
        .unwrap();

    // Insert an old op_log entry, then prune.
    sqlx::query("INSERT INTO op_log (entity_type, entity_id, op, payload, ts, device_id) VALUES ('x','y','insert','{}', ?, 'test')")
        .bind(now_ms() - 40 * DAY)
        .execute(&core.pool)
        .await
        .unwrap();
    let pruned = core.prune_op_log().await.unwrap();
    assert_eq!(pruned, 1);

    core.rebuild_fts().await.unwrap();
    let page = core.search("a", &TaskFilter::default()).await.unwrap();
    assert_eq!(page.total, 1);
}

#[tokio::test]
async fn optimistic_concurrency_conflict() {
    let (core, _d) = core().await;
    let t = core
        .create_task(CreateTaskInput { title: "t".into(), ..Default::default() })
        .await
        .unwrap();
    // Correct version succeeds and bumps it.
    core.update_task(
        &t.id,
        TaskPatch { title: Some("t2".into()), expected_version: Some(t.version), ..Default::default() },
    )
    .await
    .unwrap();
    // Stale version fails.
    let err = core
        .update_task(
            &t.id,
            TaskPatch { title: Some("t3".into()), expected_version: Some(t.version), ..Default::default() },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code(), "CONFLICT");
}

#[tokio::test]
async fn read_only_pool_cannot_write() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("omnitodo.db");
    let core = Core::open(&db, false).await.unwrap();
    core.create_task(CreateTaskInput { title: "seed".into(), ..Default::default() })
        .await
        .unwrap();
    drop(core); // release the writer

    let ro = omnitodo_core::db::open_pool(&db, true).await.unwrap();
    let res = sqlx::query("INSERT INTO meta (key, value) VALUES ('x','y')")
        .execute(&ro)
        .await;
    assert!(res.is_err(), "read-only connection must reject writes");
}

#[tokio::test]
async fn resolve_project_by_id_and_name() {
    let (core, _d) = core().await;
    let work = core
        .create_project(CreateProjectInput { name: "工作".into(), ..Default::default() })
        .await
        .unwrap();
    let life = core
        .create_project(CreateProjectInput { name: "生活".into(), ..Default::default() })
        .await
        .unwrap();

    // Ids pass straight through, names resolve case-insensitively.
    assert_eq!(core.resolve_project_id(&work.id).await.unwrap(), work.id);
    assert_eq!(core.resolve_project_id(" 工作 ").await.unwrap(), work.id);
    assert_eq!(core.resolve_project_id("生活").await.unwrap(), life.id);

    // A unique substring is accepted; an unknown name is a NotFound.
    let err = core.resolve_project_id("不存在的项目").await.unwrap_err();
    assert_eq!(err.code(), "NOT_FOUND");

    // Two projects sharing a substring must not be guessed.
    core.create_project(CreateProjectInput { name: "工作2".into(), ..Default::default() })
        .await
        .unwrap();
    assert!(core.resolve_project_id("工作2").await.is_ok(), "exact match still wins");
    let err = core.resolve_project_id("工").await.unwrap_err();
    assert_eq!(err.code(), "AMBIGUOUS_PROJECT");
}

#[tokio::test]
async fn parse_when_accepts_dates_and_instants() {
    let now = now_ms();
    let (ms, all_day) = parse_when("2026-10-12", now).unwrap();
    assert!(all_day, "a bare date is an all-day task");
    // Stored as a civil date: UTC midnight, no timezone conversion (§5.1).
    assert_eq!(ms % DAY, 0);
    assert_eq!(chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).unwrap().date_naive().to_string(), "2026-10-12");

    let (ms, all_day) = parse_when("2026-10-12 18:30", now).unwrap();
    assert!(!all_day);
    let dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).unwrap();
    assert_eq!(dt.date_naive().to_string(), "2026-10-12");
    assert_eq!((dt.hour(), dt.minute()), (18, 30));

    // Relative phrases reuse the quick-add grammar.
    let (ms, all_day) = parse_when("明天 下午3点", now).unwrap();
    assert!(!all_day);
    assert_eq!(
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).unwrap().hour(),
        15
    );
    let (ms, all_day) = parse_when("+3d", now).unwrap();
    assert!(all_day);
    assert_eq!(ms, (now / DAY + 3) * DAY);

    // Raw epoch ms (what the desktop sends) is passed through untouched.
    assert_eq!(parse_when("1791780242994", now).unwrap(), (1791780242994, false));

    // Garbage is rejected rather than silently defaulting.
    assert!(parse_when("下周三的下午", now).is_none());
    assert!(parse_when("", now).is_none());
}

#[tokio::test]
async fn inbox_filter_excludes_filed_tasks() {
    let (core, _d) = core().await;
    let p = core
        .create_project(CreateProjectInput { name: "工作".into(), ..Default::default() })
        .await
        .unwrap();
    core.create_task(CreateTaskInput { title: "unfiled".into(), ..Default::default() })
        .await
        .unwrap();
    core.create_task(CreateTaskInput {
        title: "filed".into(),
        project_id: Some(p.id.clone()),
        ..Default::default()
    })
    .await
    .unwrap();

    // The Inbox is "no project" (design §12.2), not "everything".
    let inbox = core
        .list_tasks(&TaskFilter { unfiled: true, ..Default::default() })
        .await
        .unwrap();
    assert_eq!(inbox.total, 1);
    assert_eq!(inbox.items[0].title, "unfiled");

    // Without the flag nothing is filtered out.
    let all = core.list_tasks(&TaskFilter::default()).await.unwrap();
    assert_eq!(all.total, 2);
}

// ---------------------------------------------------------------------------
// Loopback endpoint tokens (design §4.4/§4.5, amended 2026-10-15)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn endpoint_token_is_generated_once_and_then_stable() {
    // A real file, unlike `open_in_memory`: "persisted" has to mean the value
    // survives the process, so the test needs a database that outlives it.
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("omnitodo.db");

    let core = Core::open(&db, false).await.unwrap();
    let first = core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap();
    assert!(endpoint::validate_token(&first).is_ok());

    // Repeated reads must not rotate it — a client config pasted from the
    // settings page has to keep working.
    let second = core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap();
    assert_eq!(first, second);
    drop(core);

    // And it is still the same after a restart.
    let reopened = Core::open(&db, false).await.unwrap();
    let third = reopened.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap();
    assert_eq!(first, third);
}

#[tokio::test]
async fn endpoint_token_keys_are_independent() {
    let (core, _d) = core().await;
    let control = core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap();
    let http = core.endpoint_token(endpoint::HTTP_TOKEN_KEY).await.unwrap();
    assert_ne!(control, http);
}

#[tokio::test]
async fn set_endpoint_token_validates_and_persists() {
    let (core, _d) = core().await;
    core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap();

    let mine = "my-own-token_0123456789";
    core.set_endpoint_token(endpoint::CONTROL_TOKEN_KEY, mine).await.unwrap();
    assert_eq!(
        core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap(),
        mine
    );

    // A value that cannot travel in an Authorization header must be refused
    // rather than stored and silently failing every callback.
    for bad in ["", "short", &"x".repeat(129)] {
        assert!(core.set_endpoint_token(endpoint::CONTROL_TOKEN_KEY, bad).await.is_err());
    }
    for bad in [
        "\"quoted-token-0123456789\"",
        "has space 0123456789",
        "unicode-token-中文-0123456789",
    ] {
        let err = core
            .set_endpoint_token(endpoint::CONTROL_TOKEN_KEY, bad)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "VALIDATION");
    }

    // The rejected writes left the previous value alone.
    assert_eq!(
        core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap(),
        mine
    );
}

#[tokio::test]
async fn regenerate_endpoint_token_replaces_the_value() {
    let (core, _d) = core().await;
    let before = core.endpoint_token(endpoint::HTTP_TOKEN_KEY).await.unwrap();
    let after = core.regenerate_endpoint_token(endpoint::HTTP_TOKEN_KEY).await.unwrap();
    assert_ne!(before, after);
    assert!(endpoint::validate_token(&after).is_ok());
    assert_eq!(
        core.endpoint_token(endpoint::HTTP_TOKEN_KEY).await.unwrap(),
        after
    );
}

#[tokio::test]
async fn unusable_stored_token_is_replaced_on_read() {
    let (core, _d) = core().await;
    // A value stored by an older build, or edited by hand in the DB.
    core.setting_set(
        endpoint::CONTROL_TOKEN_KEY,
        &serde_json::json!("nope"),
    )
    .await
    .unwrap();

    let repaired = core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await.unwrap();
    assert_ne!(repaired, "nope");
    assert!(endpoint::validate_token(&repaired).is_ok());
}

