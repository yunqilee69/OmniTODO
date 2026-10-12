//! Recurrence engine: a focused RFC 5545 subset (design §9.3).
//!
//! Rules are parsed from either the canonical form
//! (`FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10`) or a shorthand used by the
//! quick-add parser (`daily`, `每周一,三,五`). Occurrences are computed as
//! instants; all-day tasks carry UTC-midnight instants so date arithmetic stays
//! exact (design §5.1).

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, Utc, Weekday};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecurrenceRule {
    pub freq: Freq,
    pub interval: u32,
    pub byday: Vec<Weekday>,
    pub bymonthday: Vec<u32>,
    pub bymonth: Vec<u32>,
    pub count: Option<u32>,
    pub until_ms: Option<i64>,
}

impl RecurrenceRule {
    pub fn parse(input: &str) -> Result<Self> {
        let s = input.trim();
        if s.is_empty() {
            return Err(CoreError::Validation("empty recurrence rule".into()));
        }
        // Canonical FREQ=... form?
        if s.to_ascii_uppercase().contains("FREQ=") {
            return Self::parse_canonical(s);
        }
        Self::parse_shorthand(s)
    }

    fn parse_canonical(s: &str) -> Result<Self> {
        let mut rule = RecurrenceRule {
            freq: Freq::Daily,
            interval: 1,
            byday: vec![],
            bymonthday: vec![],
            bymonth: vec![],
            count: None,
            until_ms: None,
        };
        let mut saw_freq = false;
        for part in s.split(';') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            let (k, v) = part
                .split_once('=')
                .ok_or_else(|| CoreError::Validation(format!("bad rule part: {part}")))?;
            match k.to_ascii_uppercase().as_str() {
                "FREQ" => {
                    rule.freq = match v.to_ascii_uppercase().as_str() {
                        "DAILY" => Freq::Daily,
                        "WEEKLY" => Freq::Weekly,
                        "MONTHLY" => Freq::Monthly,
                        "YEARLY" => Freq::Yearly,
                        other => {
                            return Err(CoreError::Unsupported(format!("FREQ={other}")))
                        }
                    };
                    saw_freq = true;
                }
                "INTERVAL" => {
                    rule.interval = v
                        .parse()
                        .map_err(|_| CoreError::Validation("bad INTERVAL".into()))?;
                    if rule.interval == 0 {
                        return Err(CoreError::Validation("INTERVAL must be >= 1".into()));
                    }
                }
                "BYDAY" => {
                    for d in v.split(',') {
                        rule.byday.push(parse_weekday(d)?);
                    }
                }
                "BYMONTHDAY" => {
                    for d in v.split(',') {
                        let n: u32 = d
                            .parse()
                            .map_err(|_| CoreError::Validation("bad BYMONTHDAY".into()))?;
                        if !(1..=31).contains(&n) {
                            return Err(CoreError::Validation("BYMONTHDAY out of range".into()));
                        }
                        rule.bymonthday.push(n);
                    }
                }
                "BYMONTH" => {
                    for d in v.split(',') {
                        let n: u32 = d
                            .parse()
                            .map_err(|_| CoreError::Validation("bad BYMONTH".into()))?;
                        if !(1..=12).contains(&n) {
                            return Err(CoreError::Validation("BYMONTH out of range".into()));
                        }
                        rule.bymonth.push(n);
                    }
                }
                "COUNT" => {
                    rule.count = Some(
                        v.parse()
                            .map_err(|_| CoreError::Validation("bad COUNT".into()))?,
                    );
                }
                "UNTIL" => {
                    rule.until_ms = Some(parse_until(v)?);
                }
                other => {
                    return Err(CoreError::Unsupported(format!("rule part {other}")));
                }
            }
        }
        if !saw_freq {
            return Err(CoreError::Validation("rule is missing FREQ".into()));
        }
        Ok(rule)
    }

    fn parse_shorthand(s: &str) -> Result<Self> {
        let mut interval = 1u32;
        let mut base = s;
        if let Some(rest) = s.strip_prefix("every-").or_else(|| s.strip_prefix("every ")) {
            // every-mon, every 2 weeks
            let rest = rest.trim();
            if let Some(n) = rest.split_whitespace().next().and_then(|x| x.parse::<u32>().ok()) {
                interval = n;
                if let Some(idx) = rest.find(char::is_alphabetic) {
                    base = &rest[idx..];
                }
            } else {
                base = rest;
            }
        }

        let lower = base.to_ascii_lowercase();
        let mut rule = RecurrenceRule {
            freq: Freq::Daily,
            interval,
            byday: vec![],
            bymonthday: vec![],
            bymonth: vec![],
            count: None,
            until_ms: None,
        };

        // Weekly with explicit days: 每周一,三,五 / weekly mo,we
        if lower.contains('周') || lower.contains("week") {
            rule.freq = Freq::Weekly;
            for part in split_daylist(base) {
                if let Ok(wd) = parse_weekday(&part) {
                    rule.byday.push(wd);
                }
            }
        } else if lower.contains('天') || lower.contains("day") {
            rule.freq = Freq::Daily;
        } else if lower.contains('月') || lower.contains("month") {
            rule.freq = Freq::Monthly;
        } else if lower.contains('年') || lower.contains("year") {
            rule.freq = Freq::Yearly;
        } else if let Some(rest) = lower.strip_prefix("every-") {
            rule.freq = Freq::Daily;
            let _ = rest;
        } else {
            return Err(CoreError::Validation(format!("unrecognised rule: {s}")));
        }
        Ok(rule)
    }

    /// Occurrences (instants) within `[from_ms, to_ms]`, ascending, capped.
    pub fn expand(&self, anchor_ms: i64, from_ms: i64, to_ms: i64, cap: usize) -> Vec<i64> {
        let anchor = match DateTime::<Utc>::from_timestamp_millis(anchor_ms) {
            Some(a) => a,
            None => return vec![],
        };
        if to_ms < anchor_ms {
            return vec![];
        }
        let to_date = DateTime::<Utc>::from_timestamp_millis(to_ms)
            .map(|d| d.date_naive())
            .unwrap_or_else(|| anchor.date_naive());
        let anchor_date = anchor.date_naive();
        let time = anchor.time();

        let mut dates = self.candidate_dates(anchor_date, to_date);
        // The anchor row is always the first occurrence of the series.
        dates.push(anchor_date);
        dates.sort_unstable();
        dates.dedup();
        dates.retain(|d| *d >= anchor_date);

        // Apply UNTIL / COUNT over the whole series.
        if let Some(until) = self.until_ms {
            dates.retain(|d| {
                to_ms_of(*d, time) <= until
            });
        }
        if let Some(count) = self.count {
            dates.truncate(count as usize);
        }

        let mut out: Vec<i64> = dates
            .into_iter()
            .map(|d| to_ms_of(d, time))
            .filter(|ms| *ms >= from_ms && *ms <= to_ms)
            .collect();
        out.truncate(cap);
        out
    }

    /// The next occurrence strictly after `after_ms`, if any within a horizon.
    pub fn next_after(&self, anchor_ms: i64, after_ms: i64) -> Option<i64> {
        let horizon = 3660i64 * 86_400_000; // 10 years
        let hits = self.expand(anchor_ms, after_ms + 1, after_ms + horizon, 8);
        hits.into_iter().next()
    }

    /// Serialize back to the canonical `FREQ=...` form.
    pub fn to_canonical(&self) -> String {
        let mut parts = vec![format!(
            "FREQ={}",
            match self.freq {
                Freq::Daily => "DAILY",
                Freq::Weekly => "WEEKLY",
                Freq::Monthly => "MONTHLY",
                Freq::Yearly => "YEARLY",
            }
        )];
        if self.interval != 1 {
            parts.push(format!("INTERVAL={}", self.interval));
        }
        if !self.byday.is_empty() {
            let days: Vec<&str> = self.byday.iter().map(|w| weekday_code(*w)).collect();
            parts.push(format!("BYDAY={}", days.join(",")));
        }
        if !self.bymonthday.is_empty() {
            let ds: Vec<String> = self.bymonthday.iter().map(|d| d.to_string()).collect();
            parts.push(format!("BYMONTHDAY={}", ds.join(",")));
        }
        if !self.bymonth.is_empty() {
            let ms: Vec<String> = self.bymonth.iter().map(|m| m.to_string()).collect();
            parts.push(format!("BYMONTH={}", ms.join(",")));
        }
        if let Some(c) = self.count {
            parts.push(format!("COUNT={c}"));
        }
        if let Some(u) = self.until_ms {
            parts.push(format!("UNTIL={u}"));
        }
        parts.join(";")
    }

    fn candidate_dates(&self, anchor: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
        const MAX: usize = 100_000;
        let mut out = Vec::new();
        match self.freq {
            Freq::Daily => {
                let mut d = anchor;
                while d <= to && out.len() < MAX {
                    out.push(d);
                    d += Duration::days(self.interval as i64);
                }
            }
            Freq::Weekly => {
                let days: Vec<Weekday> = if self.byday.is_empty() {
                    vec![anchor.weekday()]
                } else {
                    self.byday.clone()
                };
                let week_start =
                    anchor - Duration::days(anchor.weekday().num_days_from_monday() as i64);
                let mut w = week_start;
                while w <= to && out.len() < MAX {
                    for wd in &days {
                        let d = w + Duration::days(wd.num_days_from_monday() as i64);
                        if d >= anchor && d <= to {
                            out.push(d);
                        }
                    }
                    w += Duration::weeks(self.interval as i64);
                }
            }
            Freq::Monthly => {
                let mds: Vec<u32> = if self.bymonthday.is_empty() {
                    vec![anchor.day()]
                } else {
                    self.bymonthday.clone()
                };
                let (mut y, mut m) = (anchor.year(), anchor.month());
                let (ty, tm) = (to.year(), to.month());
                while (y, m) <= (ty, tm) && out.len() < MAX {
                    for md in &mds {
                        if let Some(d) = date_in_month(y, m, *md) {
                            if d >= anchor && d <= to {
                                out.push(d);
                            }
                        }
                    }
                    m += self.interval;
                    while m > 12 {
                        m -= 12;
                        y += 1;
                    }
                }
            }
            Freq::Yearly => {
                let months: Vec<u32> = if self.bymonth.is_empty() {
                    vec![anchor.month()]
                } else {
                    self.bymonth.clone()
                };
                let mds: Vec<u32> = if self.bymonthday.is_empty() {
                    vec![anchor.day()]
                } else {
                    self.bymonthday.clone()
                };
                let mut y = anchor.year();
                while y <= to.year() && out.len() < MAX {
                    for m in &months {
                        for md in &mds {
                            if let Some(d) = date_in_month(y, *m, *md) {
                                if d >= anchor && d <= to {
                                    out.push(d);
                                }
                            }
                        }
                    }
                    y += self.interval as i32;
                }
            }
        }
        out
    }
}

/// Occurrence anchor for a task: `due_at` else `start_at` (design §5.5).
pub fn occurrence_anchor(due_at: Option<i64>, start_at: Option<i64>) -> Option<i64> {
    due_at.or(start_at)
}

fn weekday_code(w: Weekday) -> &'static str {
    match w {
        Weekday::Mon => "MO",
        Weekday::Tue => "TU",
        Weekday::Wed => "WE",
        Weekday::Thu => "TH",
        Weekday::Fri => "FR",
        Weekday::Sat => "SA",
        Weekday::Sun => "SU",
    }
}

fn to_ms_of(d: NaiveDate, time: chrono::NaiveTime) -> i64 {
    NaiveDateTime::new(d, time).and_utc().timestamp_millis()
}

/// Day `day` of `year-month`, clamped to the month's last day.
fn date_in_month(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    let first = NaiveDate::from_ymd_opt(year, month, 1)?;
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)?
    };
    let last_day = (next_month - Duration::days(1)).day();
    let clamped = day.min(last_day);
    NaiveDate::from_ymd_opt(year, month, clamped).or(Some(first))
}

fn parse_weekday(s: &str) -> Result<Weekday> {
    let t = s.trim();
    let up = t.to_ascii_uppercase();
    Ok(match up.as_str() {
        "MO" | "MON" | "MONDAY" => Weekday::Mon,
        "TU" | "TUE" | "TUESDAY" => Weekday::Tue,
        "WE" | "WED" | "WEDNESDAY" => Weekday::Wed,
        "TH" | "THU" | "THURSDAY" => Weekday::Thu,
        "FR" | "FRI" | "FRIDAY" => Weekday::Fri,
        "SA" | "SAT" | "SATURDAY" => Weekday::Sat,
        "SU" | "SUN" | "SUNDAY" => Weekday::Sun,
        _ => match t {
            "一" | "周一" | "星期一" => Weekday::Mon,
            "二" | "周二" | "星期二" => Weekday::Tue,
            "三" | "周三" | "星期三" => Weekday::Wed,
            "四" | "周四" | "星期四" => Weekday::Thu,
            "五" | "周五" | "星期五" => Weekday::Fri,
            "六" | "周六" | "星期六" => Weekday::Sat,
            "日" | "天" | "周日" | "周天" | "星期日" | "星期天" => Weekday::Sun,
            other => {
                return Err(CoreError::Validation(format!("bad weekday: {other}")))
            }
        },
    })
}

/// Split "每周一,三,五" / "mo,we,fr" into day tokens.
fn split_daylist(s: &str) -> Vec<String> {
    let cleaned = s
        .replace('周', " 周")
        .replace("星期", " 周")
        .replace("weekly", " ")
        .replace('每', " ");
    cleaned
        .split([',', '、', ' ', '/'])
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

/// Parse an UNTIL value: either epoch ms or a date (`2026-12-31`).
fn parse_until(v: &str) -> Result<i64> {
    if let Ok(ms) = v.parse::<i64>() {
        return Ok(ms);
    }
    if let Ok(d) = NaiveDate::parse_from_str(v, "%Y-%m-%d") {
        return Ok(d
            .and_hms_opt(23, 59, 59)
            .unwrap()
            .and_utc()
            .timestamp_millis());
    }
    Err(CoreError::Validation(format!("bad UNTIL: {v}")))
}
