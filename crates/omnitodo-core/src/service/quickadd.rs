//! Quick-add shorthand parser (design §12). Pure and deterministic: no network,
//! no clock access beyond the passed `now_ms`, no DB. UI and CLI share it.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, Utc, Weekday};
use serde::{Deserialize, Serialize};

use crate::domain::*;
use crate::error::{CoreError, Result};
use crate::service::recurrence::RecurrenceRule;
use crate::service::Core;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QuickAddDraft {
    pub title: String,
    pub priority: Option<Priority>,
    pub tag_names: Vec<String>,
    pub project_name: Option<String>,
    /// Candidates for the `#project` picker (filled by the DB-aware preview).
    pub project_candidates: Vec<ProjectDto>,
    pub needs_project_choice: bool,
    pub start_at: Option<i64>,
    pub due_at: Option<i64>,
    pub all_day: bool,
    pub remind_offset_min: Option<i64>,
    pub recurrence_rule: Option<String>,
    pub description: Option<String>,
}

pub struct QuickAddParser;

impl QuickAddParser {
    /// Parse one line of shorthand. `now_ms` anchors relative words like 明天/+3d.
    pub fn parse(text: &str, now_ms: i64) -> QuickAddDraft {
        let mut draft = QuickAddDraft {
            all_day: true,
            ..Default::default()
        };
        let base = Utc::now();
        let base_date = date_of_ms(now_ms).unwrap_or(base.date_naive());

        // Description: everything after the first `::` (keeps its spaces).
        let (head, description) = match text.split_once("::") {
            Some((h, d)) => (h, Some(d.trim().to_string())),
            None => (text, None),
        };
        draft.description = description;

        let mut title_words: Vec<String> = Vec::new();
        let mut pending_date: Option<(bool, NaiveDate)> = None; // (is_due, date)

        for token in head.split_whitespace() {
            if let Some(rest) = token.strip_prefix('!') {
                if let Some(p) = Priority::parse(rest) {
                    draft.priority = Some(p);
                    continue;
                }
            }
            if let Some(rest) = token.strip_prefix('@') {
                if !rest.is_empty() {
                    draft.tag_names.push(rest.to_string());
                    continue;
                }
            }
            if let Some(rest) = token.strip_prefix('#') {
                if !rest.is_empty() {
                    draft.project_name = Some(rest.to_string());
                    continue;
                }
            }
            if let Some(rest) = token.strip_prefix('^') {
                if let Some(date) = parse_date(rest, base_date) {
                    pending_date = Some((true, date));
                    draft.due_at = Some(date_ms(date, None));
                    continue;
                }
            }
            if let Some(rest) = token.strip_prefix('>') {
                if let Some(date) = parse_date(rest, base_date) {
                    draft.start_at = Some(date_ms(date, None));
                    pending_date = Some((false, date));
                    continue;
                }
            }
            if let Some(rest) = token.strip_prefix('~') {
                if let Some(min) = parse_duration_min(rest) {
                    draft.remind_offset_min = Some(min);
                    continue;
                }
            }
            if let Some(rest) = token.strip_prefix('*') {
                if let Some(canon) = canonical_rule(rest) {
                    draft.recurrence_rule = Some(canon);
                    continue;
                }
            }
            // A bare time attaches to the most recent date token (else today).
            if let Some(t) = parse_time(token) {
                let (is_due, date) = pending_date.unwrap_or((true, base_date));
                let ms = date_ms(date, Some(t));
                if is_due {
                    draft.due_at = Some(ms);
                } else {
                    draft.start_at = Some(ms);
                }
                draft.all_day = false;
                continue;
            }
            title_words.push(token.to_string());
        }

        draft.title = title_words.join(" ").trim().to_string();
        draft
    }
}

impl Core {
    /// DB-aware preview: parse then resolve `#project` candidates (design §12.2).
    pub async fn quickadd_preview(&self, text: &str, now_ms: i64) -> Result<QuickAddDraft> {
        let mut draft = QuickAddParser::parse(text, now_ms);
        if let Some(name) = draft.project_name.clone() {
            let candidates = self.find_similar_projects(&name).await?;
            let exact = candidates
                .iter()
                .any(|c| c.name.eq_ignore_ascii_case(&name));
            draft.needs_project_choice = !exact;
            draft.project_candidates = candidates;
        }
        Ok(draft)
    }

    /// Commit a previewed draft. `project_id` is the user's confirmed choice
    /// (or the exact match); when absent the task lands in Inbox (design §12.2/§18).
    pub async fn quickadd_commit(
        &self,
        draft: &QuickAddDraft,
        project_id: Option<Id>,
    ) -> Result<TaskDto> {
        if draft.title.trim().is_empty() {
            return Err(CoreError::Validation("task title is required".into()));
        }
        let mut input = CreateTaskInput {
            title: draft.title.clone(),
            project_id,
            description: draft.description.clone(),
            priority: draft.priority,
            start_at: draft.start_at,
            due_at: draft.due_at,
            all_day: Some(draft.all_day),
            remind_enabled: Some(draft.remind_offset_min.is_some()),
            remind_offset_min: draft.remind_offset_min,
            recurrence_rule: draft.recurrence_rule.clone(),
            tag_names: draft.tag_names.clone(),
            ..Default::default()
        };
        if input.recurrence_rule.is_some() && input.due_at.is_none() && input.start_at.is_none() {
            input.due_at = Some(crate::clock::now_ms());
        }
        self.create_task(input).await
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn date_of_ms(ms: i64) -> Option<NaiveDate> {
    chrono::DateTime::<Utc>::from_timestamp_millis(ms).map(|d| d.date_naive())
}

fn date_ms(date: NaiveDate, time: Option<NaiveTime>) -> i64 {
    let t = time.unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    NaiveDateTime::new(date, t).and_utc().timestamp_millis()
}

/// Parse a date word relative to `base`.
pub fn parse_date(s: &str, base: NaiveDate) -> Option<NaiveDate> {
    let s = s.trim();
    match s {
        "今天" | "今天。" | "today" => return Some(base),
        "明天" | "tomorrow" => return Some(base + Duration::days(1)),
        "后天" => return Some(base + Duration::days(2)),
        "大后天" => return Some(base + Duration::days(3)),
        "昨天" => return Some(base - Duration::days(1)),
        _ => {}
    }
    if let Some(rest) = s.strip_prefix('+') {
        // +3d / +2w
        if let Some(num) = rest.strip_suffix('d').and_then(|n| n.parse::<i64>().ok()) {
            return Some(base + Duration::days(num));
        }
        if let Some(num) = rest.strip_suffix('w').and_then(|n| n.parse::<i64>().ok()) {
            return Some(base + Duration::weeks(num));
        }
        if let Ok(num) = rest.parse::<i64>() {
            return Some(base + Duration::days(num));
        }
    }
    // 下周X / 周X / 星期X
    if let Some(wd) = parse_weekday_word(s) {
        let next_week = s.starts_with("下");
        let today = base.weekday().num_days_from_monday() as i64;
        let target = wd.num_days_from_monday() as i64;
        let mut delta = (target - today + 7) % 7;
        if next_week {
            delta += 7;
        }
        return Some(base + Duration::days(delta));
    }
    // YYYY-MM-DD
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d);
    }
    // MM/DD or M/D
    if let Some((m, d)) = s.split_once('/') {
        let m: u32 = m.parse().ok()?;
        let d: u32 = d.parse().ok()?;
        let mut year = base.year();
        let mut candidate = NaiveDate::from_ymd_opt(year, m, d)?;
        if candidate < base {
            year += 1;
            candidate = NaiveDate::from_ymd_opt(year, m, d)?;
        }
        return Some(candidate);
    }
    None
}

fn parse_weekday_word(s: &str) -> Option<Weekday> {
    let t = s.trim_start_matches("下").trim_start_matches("本").trim_start_matches("这");
    let t = t.trim_start_matches('周').trim_start_matches("星期");
    Some(match t {
        "一" => Weekday::Mon,
        "二" => Weekday::Tue,
        "三" => Weekday::Wed,
        "四" => Weekday::Thu,
        "五" => Weekday::Fri,
        "六" => Weekday::Sat,
        "日" | "天" => Weekday::Sun,
        _ => return None,
    })
}

/// Parse a time token: `09:00`, `9:00`, `下午3点`, `下午3:30`, `3pm`.
pub fn parse_time(s: &str) -> Option<NaiveTime> {
    let mut t = s.trim().to_string();
    let mut pm = false;
    if let Some(rest) = t.strip_prefix("下午") {
        pm = true;
        t = rest.to_string();
    } else if let Some(rest) = t.strip_prefix("晚上") {
        pm = true;
        t = rest.to_string();
    } else if let Some(rest) = t.strip_prefix("上午") {
        t = rest.to_string();
    } else if let Some(rest) = t.strip_prefix("早上") {
        t = rest.to_string();
    }
    let lower = t.to_ascii_lowercase();
    if lower.ends_with("pm") {
        pm = true;
        t = t[..t.len() - 2].to_string();
    } else if lower.ends_with("am") {
        t = t[..t.len() - 2].to_string();
    }
    let t = t.trim_end_matches('点').trim().to_string();

    let (h, m) = if let Some((h, m)) = t.split_once(':') {
        (h.trim().parse::<u32>().ok()?, m.trim().parse::<u32>().ok()?)
    } else {
        (t.parse::<u32>().ok()?, 0)
    };
    if h > 23 || m > 59 {
        return None;
    }
    let h = if pm && h < 12 { h + 12 } else { h };
    NaiveTime::from_hms_opt(h, m, 0)
}

/// Parse a `--due` / `--start` value for the CLI and scripts.
///
/// Accepts raw epoch milliseconds (`1791780242994`) as well as a date phrase
/// (`2026-10-12`, `明天`, `+3d`) optionally followed by a time
/// (`2026-10-12 18:00`, `明天 下午3点`). Returns `(ms, all_day)`: a bare date is
/// an all-day value kept as a civil date (UTC midnight, design §5.1), while a
/// value carrying a time is an instant. Wall-clock phrases are read as UTC,
/// exactly like [`QuickAddDraft`] — the desktop UI is what converts the user's
/// local zone.
pub fn parse_when(input: &str, now_ms: i64) -> Option<(i64, bool)> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(ms) = s.parse::<i64>() {
        return Some((ms, false));
    }
    let base = date_of_ms(now_ms)?;
    let (date_part, time_part) = match s.split_once([' ', 'T']) {
        Some((d, t)) => (d.trim(), t.trim()),
        None => (s, ""),
    };
    let date = parse_date(date_part, base)?;
    if time_part.is_empty() {
        return Some((date_ms(date, None), true));
    }
    parse_time(time_part).map(|time| (date_ms(date, Some(time)), false))
}

/// Parse a reminder offset: `30m`, `2h`, `1d`, `1w` → minutes.
pub fn parse_duration_min(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (num, unit) = s.split_at(s.len() - 1);
    let n: i64 = num.parse().ok()?;
    Some(match unit {
        "m" | "M" => n,
        "h" | "H" => n * 60,
        "d" | "D" => n * 60 * 24,
        "w" | "W" => n * 60 * 24 * 7,
        _ => return None,
    })
}

/// Canonicalise a recurrence shorthand to the `FREQ=...` form.
pub fn canonical_rule(s: &str) -> Option<String> {
    let rule = RecurrenceRule::parse(s).ok()?;
    Some(rule.to_canonical())
}
