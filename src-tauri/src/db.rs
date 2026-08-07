use std::{collections::HashMap, path::Path};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};

use crate::models::{
    ActivityDetail, ActivityFilters, ActivitySample, ActivitySampleQuery, ActivitySamplesResponse,
    ActivitySummary, HeatmapData, HeatmapFilters, ParsedActivity, PauseSegment, SourceFileMeta,
    TrackPoint,
};

const DEFAULT_CHART_MAX_SAMPLES: usize = 2000;
const MIN_CHART_MAX_SAMPLES: usize = 50;
const MAX_CHART_MAX_SAMPLES: usize = 20_000;
const DB_SCHEMA_VERSION: i64 = 3;
pub const ACTIVITY_PARSER_VERSION: i64 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertResult {
    Added,
    Updated,
}

pub fn open_connection(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed opening sqlite database {}", db_path.display()))?;

    conn.execute_batch(
        r#"
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    "#,
    )?;

    Ok(conn)
}

pub fn init_db(db_path: &Path) -> Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed creating db directory {}", parent.display()))?;
    }

    let conn = open_connection(db_path)?;
    conn.execute_batch(
        r#"
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL UNIQUE,
      source_mtime INTEGER NOT NULL,
      source_size INTEGER NOT NULL,
      activity_start TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Other',
      sport_type TEXT NOT NULL,
      duration_seconds REAL NOT NULL,
      moving_duration_seconds REAL NOT NULL DEFAULT 0,
      distance_m REAL NOT NULL,
      elevation_gain_m REAL NOT NULL,
      avg_speed_mps REAL,
      max_speed_mps REAL,
      avg_hr REAL,
      min_hr REAL,
      max_hr REAL,
      has_gps INTEGER NOT NULL,
      track_json TEXT NOT NULL,
      pause_segments_json TEXT NOT NULL DEFAULT '[]',
      parser_version INTEGER NOT NULL DEFAULT 1,
      original_sample_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activities_start ON activities(activity_start);
    CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport_type);

    CREATE TABLE IF NOT EXISTS activity_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      elapsed_seconds REAL NOT NULL,
      distance_m REAL,
      speed_mps REAL,
      heart_rate REAL,
      cadence REAL,
      power_watts REAL,
      altitude_m REAL,
      lat REAL,
      lon REAL,
      sample_time TEXT,
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_samples_activity_id ON activity_samples(activity_id);
    "#,
    )?;

    apply_legacy_migrations(&conn)?;

    Ok(())
}

fn apply_legacy_migrations(conn: &Connection) -> Result<()> {
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if user_version < 1 {
        ensure_activity_category_column(conn)?;
        ensure_activity_title_column(conn)?;
        ensure_activity_min_hr_column(conn)?;
        ensure_activity_moving_duration_column(conn)?;
        conn.execute_batch("PRAGMA user_version = 1;")?;
    }

    if user_version < 2 {
        ensure_activity_sample_cadence_column(conn)?;
        ensure_activity_sample_power_column(conn)?;
        conn.execute_batch("PRAGMA user_version = 2;")?;
    }

    if user_version < 3 {
        ensure_activity_pause_segments_column(conn)?;
        ensure_activity_parser_version_column(conn)?;
        conn.execute_batch(&format!("PRAGMA user_version = {DB_SCHEMA_VERSION};"))?;
    }

    Ok(())
}

fn ensure_activity_category_column(conn: &Connection) -> Result<()> {
    let has_category = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activities') WHERE name = 'category' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_category {
        conn.execute(
            "ALTER TABLE activities ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'",
            [],
        )?;
    }

    conn.execute_batch(
        r#"
    UPDATE activities
    SET category = CASE
      WHEN lower(sport_type) LIKE '%run%' OR lower(sport_type) LIKE '%jog%' THEN 'Running'
      WHEN lower(sport_type) LIKE '%bik%' OR lower(sport_type) LIKE '%cycl%' OR lower(sport_type) LIKE '%ride%' OR lower(sport_type) LIKE '%spin%' THEN 'Biking'
      WHEN lower(sport_type) LIKE '%hike%' THEN 'Hiking'
      WHEN lower(sport_type) LIKE '%walk%' THEN 'Walking'
      WHEN lower(sport_type) LIKE '%swim%' THEN 'Swimming'
      WHEN lower(sport_type) LIKE '%row%' THEN 'Rowing'
      WHEN lower(sport_type) LIKE '%strength%' OR lower(sport_type) LIKE '%gym%' OR lower(sport_type) LIKE '%weight%' OR lower(sport_type) LIKE '%lift%' OR lower(sport_type) = 'training' OR lower(sport_type) LIKE '%fitness equipment%' THEN 'Strength'
      WHEN lower(sport_type) LIKE '%yoga%' OR lower(sport_type) LIKE '%pilates%' THEN 'Mobility'
      ELSE COALESCE(NULLIF(category, ''), 'Other')
    END;

    CREATE INDEX IF NOT EXISTS idx_activities_category ON activities(category);
    "#,
    )?;

    Ok(())
}

fn ensure_activity_title_column(conn: &Connection) -> Result<()> {
    let has_title = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activities') WHERE name = 'title' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_title {
        conn.execute(
            "ALTER TABLE activities ADD COLUMN title TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    conn.execute_batch(
        r#"
    UPDATE activities
    SET title = CASE
      WHEN trim(COALESCE(title, '')) <> '' THEN title
      WHEN lower(sport_type) LIKE '%weight%' OR lower(sport_type) LIKE '%lift%' OR lower(sport_type) LIKE '%strength%' THEN 'Weight Training'
      WHEN lower(sport_type) = 'training' OR lower(sport_type) LIKE '%fitness equipment%' THEN 'Strength Training'
      WHEN trim(COALESCE(sport_type, '')) <> '' THEN sport_type
      WHEN trim(COALESCE(category, '')) <> '' THEN category
      ELSE 'Workout'
    END;
    "#,
    )?;

    Ok(())
}

fn ensure_activity_min_hr_column(conn: &Connection) -> Result<()> {
    let has_min_hr = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activities') WHERE name = 'min_hr' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_min_hr {
        conn.execute("ALTER TABLE activities ADD COLUMN min_hr REAL", [])?;
    }

    conn.execute_batch(
        r#"
    UPDATE activities
    SET min_hr = (
      SELECT MIN(heart_rate)
      FROM activity_samples
      WHERE activity_id = activities.id
        AND heart_rate IS NOT NULL
    )
    WHERE min_hr IS NULL;
    "#,
    )?;

    Ok(())
}

fn ensure_activity_moving_duration_column(conn: &Connection) -> Result<()> {
    let has_moving_duration = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activities') WHERE name = 'moving_duration_seconds' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_moving_duration {
        conn.execute(
            "ALTER TABLE activities ADD COLUMN moving_duration_seconds REAL NOT NULL DEFAULT 0",
            [],
        )?;
    }

    conn.execute_batch(
        r#"
    UPDATE activities
    SET moving_duration_seconds = CASE
      WHEN COALESCE(moving_duration_seconds, 0) <= 0 THEN COALESCE(duration_seconds, 0)
      ELSE MIN(moving_duration_seconds, COALESCE(duration_seconds, moving_duration_seconds))
    END;
    "#,
    )?;

    Ok(())
}

fn ensure_activity_sample_cadence_column(conn: &Connection) -> Result<()> {
    let has_cadence = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activity_samples') WHERE name = 'cadence' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_cadence {
        conn.execute("ALTER TABLE activity_samples ADD COLUMN cadence REAL", [])?;
    }

    Ok(())
}

fn ensure_activity_sample_power_column(conn: &Connection) -> Result<()> {
    let has_power_watts = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activity_samples') WHERE name = 'power_watts' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_power_watts {
        conn.execute(
            "ALTER TABLE activity_samples ADD COLUMN power_watts REAL",
            [],
        )?;
    }

    Ok(())
}

fn ensure_activity_pause_segments_column(conn: &Connection) -> Result<()> {
    let has_pause_segments = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activities') WHERE name = 'pause_segments_json' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_pause_segments {
        conn.execute(
            "ALTER TABLE activities ADD COLUMN pause_segments_json TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }

    conn.execute(
        "UPDATE activities SET pause_segments_json = '[]' WHERE trim(COALESCE(pause_segments_json, '')) = ''",
        [],
    )?;

    Ok(())
}

fn ensure_activity_parser_version_column(conn: &Connection) -> Result<()> {
    let has_parser_version = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('activities') WHERE name = 'parser_version' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !has_parser_version {
        conn.execute(
            "ALTER TABLE activities ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }

    Ok(())
}

pub fn source_file_meta_map(conn: &Connection) -> Result<HashMap<String, SourceFileMeta>> {
    let mut stmt = conn
        .prepare("SELECT source_path, source_mtime, source_size, parser_version FROM activities")?;

    let mut map = HashMap::new();
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            SourceFileMeta {
                source_mtime: row.get(1)?,
                source_size: row.get(2)?,
                parser_version: row.get(3)?,
            },
        ))
    })?;

    for row in rows {
        let (path, meta) = row?;
        map.insert(path, meta);
    }

    Ok(map)
}

pub fn delete_activity_by_source_path(conn: &Connection, source_path: &str) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM activities WHERE source_path = ?1",
        params![source_path],
    )?;
    Ok(deleted)
}

pub fn clear_activity_cache(conn: &mut Connection) -> Result<()> {
    let transaction = conn.transaction()?;
    transaction.execute("DELETE FROM activity_samples", [])?;
    transaction.execute("DELETE FROM activities", [])?;
    transaction.commit()?;
    Ok(())
}

pub fn upsert_activity(
    conn: &mut Connection,
    source_path: &str,
    source_mtime: i64,
    source_size: i64,
    parsed: &ParsedActivity,
) -> Result<UpsertResult> {
    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM activities WHERE source_path = ?1",
            params![source_path],
            |row| row.get(0),
        )
        .optional()?;

    let track_json = serde_json::to_string(&parsed.track)?;
    let pause_segments_json = serde_json::to_string(&parsed.pause_segments)?;

    conn.execute(
        r#"
    INSERT INTO activities (
      source_path,
      source_mtime,
      source_size,
      activity_start,
      title,
      category,
      sport_type,
      duration_seconds,
      moving_duration_seconds,
      distance_m,
      elevation_gain_m,
      avg_speed_mps,
      max_speed_mps,
      avg_hr,
      min_hr,
      max_hr,
      has_gps,
      track_json,
      pause_segments_json,
      parser_version,
      original_sample_count,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, CURRENT_TIMESTAMP)
    ON CONFLICT(source_path) DO UPDATE SET
      source_mtime = excluded.source_mtime,
      source_size = excluded.source_size,
      activity_start = excluded.activity_start,
      title = excluded.title,
      category = excluded.category,
      sport_type = excluded.sport_type,
      duration_seconds = excluded.duration_seconds,
      moving_duration_seconds = excluded.moving_duration_seconds,
      distance_m = excluded.distance_m,
      elevation_gain_m = excluded.elevation_gain_m,
      avg_speed_mps = excluded.avg_speed_mps,
      max_speed_mps = excluded.max_speed_mps,
      avg_hr = excluded.avg_hr,
      min_hr = excluded.min_hr,
      max_hr = excluded.max_hr,
      has_gps = excluded.has_gps,
      track_json = excluded.track_json,
      pause_segments_json = excluded.pause_segments_json,
      parser_version = excluded.parser_version,
      original_sample_count = excluded.original_sample_count,
      updated_at = CURRENT_TIMESTAMP
    "#,
        params![
            source_path,
            source_mtime,
            source_size,
            &parsed.start_time,
            &parsed.title,
            &parsed.category,
            &parsed.sport_type,
            parsed.duration_seconds,
            parsed.moving_duration_seconds,
            parsed.distance_m,
            parsed.elevation_gain_m,
            parsed.avg_speed_mps,
            parsed.max_speed_mps,
            parsed.avg_hr,
            parsed.min_hr,
            parsed.max_hr,
            if parsed.has_gps { 1 } else { 0 },
            track_json,
            pause_segments_json,
            ACTIVITY_PARSER_VERSION,
            parsed.original_sample_count as i64,
        ],
    )?;

    let activity_id: i64 = conn.query_row(
        "SELECT id FROM activities WHERE source_path = ?1",
        params![source_path],
        |row| row.get(0),
    )?;

    let transaction = conn.transaction()?;
    transaction.execute(
        "DELETE FROM activity_samples WHERE activity_id = ?1",
        params![activity_id],
    )?;

    {
        let mut insert_stmt = transaction.prepare(
            r#"
      INSERT INTO activity_samples (
        activity_id,
        elapsed_seconds,
        distance_m,
        speed_mps,
        heart_rate,
        cadence,
        power_watts,
        altitude_m,
        lat,
        lon,
        sample_time
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      "#,
        )?;

        for sample in &parsed.samples {
            insert_stmt.execute(params![
                activity_id,
                sample.elapsed_seconds,
                sample.distance_m,
                sample.speed_mps,
                sample.heart_rate,
                sample.cadence,
                sample.power_watts,
                sample.altitude_m,
                sample.lat,
                sample.lon,
                sample.timestamp,
            ])?;
        }
    }

    transaction.commit()?;

    Ok(if existing_id.is_some() {
        UpsertResult::Updated
    } else {
        UpsertResult::Added
    })
}

fn map_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivitySummary> {
    Ok(ActivitySummary {
        id: row.get(0)?,
        source_path: row.get(1)?,
        activity_start: row.get(2)?,
        title: row.get(3)?,
        category: row.get(4)?,
        sport_type: row.get(5)?,
        duration_seconds: row.get(6)?,
        moving_duration_seconds: row.get(7)?,
        distance_m: row.get(8)?,
        elevation_gain_m: row.get(9)?,
        avg_speed_mps: row.get(10)?,
        max_speed_mps: row.get(11)?,
        avg_hr: row.get(12)?,
        min_hr: row.get(13)?,
        max_hr: row.get(14)?,
        has_gps: row.get::<_, i64>(15)? == 1,
    })
}

fn downsample_track(points: &[TrackPoint], stride: usize) -> Vec<TrackPoint> {
    if stride == 0 {
        return Vec::new();
    }

    if points.len() <= 2 || stride <= 1 {
        return points.to_vec();
    }

    let mut sampled = Vec::with_capacity((points.len() / stride).max(2));

    for point in points.iter().step_by(stride) {
        sampled.push(point.clone());
    }

    let last_point = points.last().cloned();
    if let Some(last_point) = last_point {
        let needs_last = sampled
            .last()
            .map(|point| point.lat != last_point.lat || point.lon != last_point.lon)
            .unwrap_or(true);
        if needs_last {
            sampled.push(last_point);
        }
    }

    sampled
}

fn downsample_cloned<T: Clone>(items: &[T], max: usize) -> Vec<T> {
    if max == 0 {
        return Vec::new();
    }

    if items.len() <= max {
        return items.to_vec();
    }

    if max <= 1 {
        return vec![items[items.len() - 1].clone()];
    }

    let stride = ((items.len() - 1) as f64 / (max - 1) as f64).ceil() as usize;
    let mut output = Vec::with_capacity(max);
    let mut index = 0;

    while index < items.len() - 1 && output.len() < max - 1 {
        output.push(items[index].clone());
        index += stride;
    }

    output.push(items[items.len() - 1].clone());
    output
}

fn clamp_chart_max_samples(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_CHART_MAX_SAMPLES)
        .clamp(MIN_CHART_MAX_SAMPLES, MAX_CHART_MAX_SAMPLES)
}

fn parse_pause_segments_json(value: &str) -> Vec<PauseSegment> {
    serde_json::from_str(value).unwrap_or_default()
}

fn apply_pause_visibility(
    samples: &[ActivitySample],
    pause_segments: &[PauseSegment],
    hide_pauses: bool,
) -> Vec<ActivitySample> {
    if !hide_pauses || pause_segments.is_empty() {
        return samples.to_vec();
    }

    let mut visible = Vec::with_capacity(samples.len());
    let mut pause_index = 0_usize;
    let mut paused_seconds_before = 0.0;

    for sample in samples {
        while let Some(segment) = pause_segments.get(pause_index) {
            if sample.elapsed_seconds >= segment.end_elapsed_seconds {
                paused_seconds_before += segment.duration_seconds.max(0.0);
                pause_index += 1;
            } else {
                break;
            }
        }

        let in_pause = pause_segments
            .get(pause_index)
            .map(|segment| {
                sample.elapsed_seconds >= segment.start_elapsed_seconds
                    && sample.elapsed_seconds < segment.end_elapsed_seconds
            })
            .unwrap_or(false);

        if in_pause {
            continue;
        }

        let mut adjusted = sample.clone();
        adjusted.elapsed_seconds = (sample.elapsed_seconds - paused_seconds_before).max(0.0);
        visible.push(adjusted);
    }

    visible
}

pub fn list_activities(
    conn: &Connection,
    filters: &ActivityFilters,
) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        r#"
    SELECT
      activities.id,
      activities.source_path,
      activities.activity_start,
      activities.title,
      activities.category,
      activities.sport_type,
      activities.duration_seconds,
      activities.moving_duration_seconds,
      activities.distance_m,
      activities.elevation_gain_m,
      activities.avg_speed_mps,
      activities.max_speed_mps,
      activities.avg_hr,
      activities.min_hr,
      activities.max_hr,
      activities.has_gps
    FROM activities
    WHERE (?1 IS NULL OR date(activities.activity_start) >= date(?1))
      AND (?2 IS NULL OR date(activities.activity_start) <= date(?2))
      AND (?3 IS NULL OR activities.category = ?3)
      AND (?4 IS NULL OR activities.sport_type = ?4)
      AND (?5 IS NULL OR activities.distance_m >= ?5)
      AND (?6 IS NULL OR activities.distance_m <= ?6)
      AND (?7 IS NULL OR date(activities.activity_start) = date(?7))
    ORDER BY activities.activity_start DESC
    "#,
    )?;

    let rows = stmt.query_map(
        params![
            filters.start_date.as_deref(),
            filters.end_date.as_deref(),
            filters.category.as_deref(),
            filters.sport_type.as_deref(),
            filters.min_distance,
            filters.max_distance,
            filters.day.as_deref(),
        ],
        map_summary_row,
    )?;

    let mut activities = Vec::new();
    for row in rows {
        activities.push(row?);
    }

    Ok(activities)
}

pub fn get_heatmap_data(conn: &Connection, filters: &HeatmapFilters) -> Result<HeatmapData> {
    const DEFAULT_MAX_HEATMAP_POINTS: usize = 60_000;

    let mut sql = String::from(
        r#"
    SELECT track_json
    FROM activities
    WHERE has_gps = 1
    "#,
    );

    let mut params: Vec<Value> = Vec::new();

    if let Some(start_date) = &filters.start_date {
        sql.push_str(" AND date(activity_start) >= date(?)");
        params.push(Value::Text(start_date.clone()));
    }

    if let Some(end_date) = &filters.end_date {
        sql.push_str(" AND date(activity_start) <= date(?)");
        params.push(Value::Text(end_date.clone()));
    }

    if let Some(category) = &filters.category {
        sql.push_str(" AND category = ?");
        params.push(Value::Text(category.clone()));
    }

    if let Some(sport_type) = &filters.sport_type {
        sql.push_str(" AND sport_type = ?");
        params.push(Value::Text(sport_type.clone()));
    }

    if let Some(activity_ids) = filters.activity_ids.as_ref().filter(|ids| !ids.is_empty()) {
        sql.push_str(" AND id IN (");

        for (index, activity_id) in activity_ids.iter().enumerate() {
            if index > 0 {
                sql.push_str(", ");
            }
            sql.push('?');
            params.push(Value::Integer(*activity_id));
        }

        sql.push(')');
    }

    sql.push_str(" ORDER BY activity_start DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params.iter()), |row| {
        row.get::<_, String>(0)
    })?;

    let mut tracks = Vec::<Vec<TrackPoint>>::new();
    let mut activity_count = 0_usize;

    for row in rows {
        let track_json = row?;
        let track: Vec<TrackPoint> = serde_json::from_str(&track_json).unwrap_or_default();

        if track.is_empty() {
            continue;
        }

        activity_count += 1;
        tracks.push(track);
    }

    let original_point_count = tracks.iter().map(|track| track.len()).sum::<usize>();
    let max_points = filters.max_points.unwrap_or(DEFAULT_MAX_HEATMAP_POINTS);
    let stride = if max_points == 0 || original_point_count <= max_points {
        1
    } else {
        ((original_point_count as f64) / (max_points as f64)).ceil() as usize
    };

    let tracks = if stride > 1 {
        tracks
            .into_iter()
            .map(|track| downsample_track(&track, stride))
            .collect::<Vec<_>>()
    } else {
        tracks
    };

    let returned_point_count = tracks.iter().map(|track| track.len()).sum::<usize>();

    Ok(HeatmapData {
        tracks,
        activity_count,
        original_point_count,
        returned_point_count,
    })
}

fn fetch_activity_samples(conn: &Connection, id: i64) -> Result<Vec<ActivitySample>> {
    let mut sample_stmt = conn.prepare(
        r#"
    SELECT elapsed_seconds, distance_m, speed_mps, heart_rate, cadence, power_watts, altitude_m, lat, lon, sample_time
    FROM activity_samples
    WHERE activity_id = ?1
    ORDER BY elapsed_seconds ASC
    "#,
    )?;

    let sample_rows = sample_stmt.query_map(params![id], |row| {
        Ok(ActivitySample {
            elapsed_seconds: row.get(0)?,
            distance_m: row.get(1)?,
            speed_mps: row.get(2)?,
            heart_rate: row.get(3)?,
            cadence: row.get(4)?,
            power_watts: row.get(5)?,
            altitude_m: row.get(6)?,
            lat: row.get(7)?,
            lon: row.get(8)?,
            timestamp: row.get(9)?,
        })
    })?;

    let mut samples = Vec::new();
    for sample in sample_rows {
        samples.push(sample?);
    }

    Ok(samples)
}

pub fn get_all_activity_samples(conn: &Connection, id: i64) -> Result<Vec<ActivitySample>> {
    fetch_activity_samples(conn, id)
}

fn sample_matches_distance_window(
    sample: &ActivitySample,
    summary: &ActivitySummary,
    last_distance_m: &mut f64,
    min_distance_m: Option<f64>,
    max_distance_m: Option<f64>,
) -> bool {
    if min_distance_m.is_none() && max_distance_m.is_none() {
        return true;
    }

    let total_distance_m = summary.distance_m.max(0.0);
    let total_duration_seconds = summary.duration_seconds.max(1.0);
    let estimated_distance_m = if total_distance_m > 0.0 {
        (sample.elapsed_seconds / total_duration_seconds) * total_distance_m
    } else {
        *last_distance_m
    };
    let sample_distance_m =
        (sample.distance_m.unwrap_or(estimated_distance_m)).max(*last_distance_m);
    *last_distance_m = sample_distance_m;

    if let Some(min_distance_m) = min_distance_m {
        if sample_distance_m < min_distance_m {
            return false;
        }
    }

    if let Some(max_distance_m) = max_distance_m {
        if sample_distance_m > max_distance_m {
            return false;
        }
    }

    true
}

fn sample_activity_window(
    all_samples: &[ActivitySample],
    summary: &ActivitySummary,
    pause_segments: &[PauseSegment],
    query: &ActivitySampleQuery,
) -> (Vec<ActivitySample>, usize) {
    let min_distance_m = query.distance_min_km.map(|value| value.max(0.0) * 1000.0);
    let max_distance_m = query.distance_max_km.map(|value| value.max(0.0) * 1000.0);

    let filtered = if min_distance_m.is_none() && max_distance_m.is_none() {
        all_samples.to_vec()
    } else {
        let mut filtered = Vec::new();
        let mut last_distance_m = 0.0;

        for sample in all_samples {
            if sample_matches_distance_window(
                sample,
                summary,
                &mut last_distance_m,
                min_distance_m,
                max_distance_m,
            ) {
                filtered.push(sample.clone());
            }
        }

        filtered
    };

    let visible = apply_pause_visibility(
        &filtered,
        pause_segments,
        query.hide_pauses.unwrap_or(false),
    );
    let matching_sample_count = visible.len();
    let returned = if query.downsample.unwrap_or(true) {
        downsample_cloned(&visible, clamp_chart_max_samples(query.max_samples))
    } else {
        visible
    };
    (returned, matching_sample_count)
}

pub fn get_activity(conn: &Connection, id: i64) -> Result<ActivityDetail> {
    let mut stmt = conn.prepare(
        r#"
    SELECT
      id,
      source_path,
      activity_start,
      title,
      category,
      sport_type,
      duration_seconds,
      moving_duration_seconds,
      distance_m,
      elevation_gain_m,
      avg_speed_mps,
      max_speed_mps,
      avg_hr,
      min_hr,
      max_hr,
      has_gps,
      track_json,
      pause_segments_json,
      original_sample_count
    FROM activities
    WHERE id = ?1
    "#,
    )?;

    let (summary, track_json, pause_segments_json, original_sample_count): (
        ActivitySummary,
        String,
        String,
        i64,
    ) = stmt
        .query_row(params![id], |row| {
            Ok((
                ActivitySummary {
                    id: row.get(0)?,
                    source_path: row.get(1)?,
                    activity_start: row.get(2)?,
                    title: row.get(3)?,
                    category: row.get(4)?,
                    sport_type: row.get(5)?,
                    duration_seconds: row.get(6)?,
                    moving_duration_seconds: row.get(7)?,
                    distance_m: row.get(8)?,
                    elevation_gain_m: row.get(9)?,
                    avg_speed_mps: row.get(10)?,
                    max_speed_mps: row.get(11)?,
                    avg_hr: row.get(12)?,
                    min_hr: row.get(13)?,
                    max_hr: row.get(14)?,
                    has_gps: row.get::<_, i64>(15)? == 1,
                },
                row.get(16)?,
                row.get(17)?,
                row.get(18)?,
            ))
        })
        .optional()?
        .ok_or_else(|| anyhow!("activity {} not found", id))?;

    let track: Vec<TrackPoint> = serde_json::from_str(&track_json).unwrap_or_default();
    let pause_segments = parse_pause_segments_json(&pause_segments_json);

    Ok(ActivityDetail {
        summary,
        track,
        pause_segments,
        original_sample_count: original_sample_count as usize,
    })
}

pub fn get_activity_samples(
    conn: &Connection,
    id: i64,
    query: &ActivitySampleQuery,
) -> Result<ActivitySamplesResponse> {
    let summary: ActivitySummary = conn
        .query_row(
            r#"
        SELECT
          id,
          source_path,
          activity_start,
          title,
          category,
          sport_type,
          duration_seconds,
          moving_duration_seconds,
          distance_m,
          elevation_gain_m,
          avg_speed_mps,
          max_speed_mps,
          avg_hr,
          min_hr,
          max_hr,
          has_gps
        FROM activities
        WHERE id = ?1
        "#,
            params![id],
            map_summary_row,
        )
        .optional()?
        .ok_or_else(|| anyhow!("activity {} not found", id))?;

    let pause_segments_json: String = conn
        .query_row(
            "SELECT pause_segments_json FROM activities WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| anyhow!("activity {} not found", id))?;
    let pause_segments = parse_pause_segments_json(&pause_segments_json);

    let original_sample_count: i64 = conn
        .query_row(
            "SELECT original_sample_count FROM activities WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| anyhow!("activity {} not found", id))?;

    let all_samples = fetch_activity_samples(conn, id)?;
    let (samples, matching_sample_count) =
        sample_activity_window(&all_samples, &summary, &pause_segments, query);

    Ok(ActivitySamplesResponse {
        returned_sample_count: samples.len(),
        samples,
        original_sample_count: original_sample_count as usize,
        matching_sample_count,
    })
}

#[cfg(test)]
mod tests {
    use crate::models::{ActivitySample, ActivitySampleQuery, ActivitySummary, PauseSegment};

    use super::{apply_pause_visibility, sample_activity_window};

    #[test]
    fn hiding_pauses_compresses_elapsed_time_and_drops_paused_samples() {
        let samples = vec![
            ActivitySample {
                elapsed_seconds: 10.0,
                distance_m: Some(100.0),
                speed_mps: Some(1.0),
                heart_rate: None,
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 12.0,
                distance_m: Some(100.0),
                speed_mps: Some(0.0),
                heart_rate: None,
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 20.0,
                distance_m: Some(120.0),
                speed_mps: Some(1.0),
                heart_rate: None,
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
        ];
        let pause_segments = vec![PauseSegment {
            start_elapsed_seconds: 11.0,
            end_elapsed_seconds: 18.0,
            duration_seconds: 7.0,
            start_timestamp: None,
            end_timestamp: None,
        }];

        let visible = apply_pause_visibility(&samples, &pause_segments, true);

        assert_eq!(visible.len(), 2);
        assert_eq!(visible[0].elapsed_seconds, 10.0);
        assert_eq!(visible[1].elapsed_seconds, 13.0);
    }

    #[test]
    fn requesting_full_resolution_samples_skips_downsampling() {
        let samples: Vec<_> = (0..100)
            .map(|elapsed_seconds| ActivitySample {
                elapsed_seconds: f64::from(elapsed_seconds),
                distance_m: Some(f64::from(elapsed_seconds)),
                speed_mps: Some(1.0),
                heart_rate: Some(120.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            })
            .collect();
        let summary = ActivitySummary {
            id: 1,
            source_path: "activity.fit".to_string(),
            activity_start: "2026-08-07T10:00:00Z".to_string(),
            title: "Test".to_string(),
            category: "Running".to_string(),
            sport_type: "Running".to_string(),
            duration_seconds: 99.0,
            moving_duration_seconds: 99.0,
            distance_m: 99.0,
            elevation_gain_m: 0.0,
            avg_speed_mps: Some(1.0),
            max_speed_mps: Some(1.0),
            avg_hr: Some(120.0),
            min_hr: Some(120.0),
            max_hr: Some(120.0),
            has_gps: false,
        };
        let query = ActivitySampleQuery {
            max_samples: Some(50),
            downsample: Some(false),
            ..ActivitySampleQuery::default()
        };

        let (returned, matching_count) = sample_activity_window(&samples, &summary, &[], &query);

        assert_eq!(matching_count, 100);
        assert_eq!(returned.len(), 100);
    }
}
