use std::{fs::File, io::BufReader, path::Path};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use fitparser::{self, Value};
use quick_xml::{events::Event, Reader};
use thiserror::Error;

use crate::models::{ActivitySample, ParsedActivity, PauseSegment, TrackPoint};

const MAX_UI_POINTS: usize = 2000;
const FIT_SEMICIRCLES_TO_DEGREES: f64 = 180.0 / 2_147_483_648.0;
const MOVING_SPEED_THRESHOLD_MPS: f64 = 0.5;
const MOVING_MAX_SAMPLE_GAP_SECONDS: f64 = 300.0;
const DISTANCE_TOTAL_RECONCILIATION_THRESHOLD_RATIO: f64 = 0.05;

#[derive(Debug, Error)]
enum ParseActivityError {
    #[error("no trackpoints in {0}")]
    NoTrackpoints(String),
}

pub fn is_no_trackpoints_error(err: &anyhow::Error) -> bool {
    err.downcast_ref::<ParseActivityError>()
        .map(|cause| matches!(cause, ParseActivityError::NoTrackpoints(_)))
        .unwrap_or(false)
}

#[derive(Debug, Default, Clone)]
struct RawTrackPoint {
    time: Option<DateTime<Utc>>,
    lat: Option<f64>,
    lon: Option<f64>,
    altitude: Option<f64>,
    heart_rate: Option<f64>,
    cadence: Option<f64>,
    power_watts: Option<f64>,
    distance: Option<f64>,
    speed: Option<f64>,
}

#[derive(Debug, Default, Clone)]
struct SummaryMetrics {
    distance_m: f64,
    elapsed_duration_seconds: Option<f64>,
    timer_duration_seconds: Option<f64>,
    elevation_gain_m: Option<f64>,
    avg_speed_mps: Option<f64>,
    max_speed_mps: Option<f64>,
    avg_hr: Option<f64>,
    min_hr: Option<f64>,
    max_hr: Option<f64>,
}

#[derive(Debug, Clone)]
struct RawPauseSpan {
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
}

fn normalize_tag(bytes: &[u8]) -> String {
    let tag = String::from_utf8_lossy(bytes).to_string();
    tag.rsplit(':').next().unwrap_or(&tag).to_string()
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn parse_f64(value: &str) -> Option<f64> {
    value.parse::<f64>().ok()
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn derive_activity_category(sport_type: &str, notes: Option<&str>) -> String {
    let sport = sport_type.trim().to_ascii_lowercase();
    let notes = notes.unwrap_or("").trim().to_ascii_lowercase();
    let combined = format!("{sport} {notes}");

    if contains_any(&combined, &["run", "jog", "treadmill"]) {
        "Running".to_string()
    } else if contains_any(
        &combined,
        &[
            "biking", "bike", "bicycle", "cycling", "cycle", "ride", "spin",
        ],
    ) {
        "Biking".to_string()
    } else if contains_any(
        &combined,
        &["hike", "hiking", "trail", "mountaineering", "trek"],
    ) {
        "Hiking".to_string()
    } else if contains_any(&combined, &["walk"]) {
        "Walking".to_string()
    } else if contains_any(&combined, &["swim"]) {
        "Swimming".to_string()
    } else if contains_any(&combined, &["row", "rowing", "erg"]) {
        "Rowing".to_string()
    } else if contains_any(
        &combined,
        &[
            "strength",
            "bodyweight",
            "weight",
            "lifting",
            "gym",
            "crossfit",
            "hiit",
            "workout",
        ],
    ) {
        "Strength".to_string()
    } else if contains_any(&combined, &["yoga", "pilates", "mobility", "stretch"]) {
        "Mobility".to_string()
    } else {
        "Other".to_string()
    }
}

fn humanize_identifier(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let normalized = trimmed
        .replace(['_', '-'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if normalized.is_empty() {
        return String::new();
    }

    normalized
        .split(' ')
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn derive_activity_title(
    path: &Path,
    sport_type: &str,
    category: &str,
    explicit_title: Option<&str>,
    notes: Option<&str>,
) -> String {
    let candidate = explicit_title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            notes.and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
        });

    if let Some(candidate) = candidate {
        let humanized = humanize_identifier(candidate);
        if !humanized.is_empty() {
            return humanized;
        }
        return candidate.to_string();
    }

    let sport_title = humanize_identifier(sport_type);
    if !sport_title.is_empty() && !sport_title.eq_ignore_ascii_case("other") {
        return sport_title;
    }

    if !category.trim().is_empty() {
        return category.to_string();
    }

    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(humanize_identifier)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Workout".to_string())
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6_371_000.0_f64;
    let lat1r = lat1.to_radians();
    let lat2r = lat2.to_radians();
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();

    let a = (dlat / 2.0).sin().powi(2) + lat1r.cos() * lat2r.cos() * (dlon / 2.0).sin().powi(2);

    2.0 * r * a.sqrt().atan2((1.0 - a).sqrt())
}

fn downsample<T: Clone>(items: &[T], max: usize) -> Vec<T> {
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

fn fit_value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Byte(v) => Some(*v as f64),
        Value::Enum(v) => Some(*v as f64),
        Value::SInt8(v) => Some(*v as f64),
        Value::UInt8(v) => Some(*v as f64),
        Value::UInt8z(v) => Some(*v as f64),
        Value::SInt16(v) => Some(*v as f64),
        Value::UInt16(v) => Some(*v as f64),
        Value::UInt16z(v) => Some(*v as f64),
        Value::SInt32(v) => Some(*v as f64),
        Value::UInt32(v) => Some(*v as f64),
        Value::UInt32z(v) => Some(*v as f64),
        Value::SInt64(v) => Some(*v as f64),
        Value::UInt64(v) => Some(*v as f64),
        Value::UInt64z(v) => Some(*v as f64),
        Value::Float32(v) => Some(*v as f64),
        Value::Float64(v) => Some(*v),
        _ => None,
    }
}

fn fit_value_as_u8(value: &Value) -> Option<u8> {
    match value {
        Value::Enum(v) | Value::Byte(v) | Value::UInt8(v) => Some(*v),
        _ => None,
    }
}

fn fit_value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(v) => Some(v.clone()),
        _ => None,
    }
}

fn fit_value_as_time(value: &Value) -> Option<DateTime<Utc>> {
    match value {
        Value::Timestamp(v) => Some(v.with_timezone(&Utc)),
        _ => None,
    }
}

fn normalize_fit_position(name: &str, units: &str, raw: f64) -> f64 {
    let looks_like_semicircles = units.eq_ignore_ascii_case("semicircles")
        || ((name == "position_lat" || name == "position_long") && raw.abs() > 180.0);

    if looks_like_semicircles {
        raw * FIT_SEMICIRCLES_TO_DEGREES
    } else {
        raw
    }
}

fn fit_sport_code_to_name(code: u8) -> &'static str {
    match code {
        1 => "Running",
        2 => "Cycling",
        4 => "Fitness Equipment",
        5 => "Swimming",
        10 => "Training",
        11 => "Walking",
        15 => "Rowing",
        16 => "Mountaineering",
        17 => "Hiking",
        18 => "Multisport",
        19 => "Paddling",
        21 => "E-Biking",
        25 => "Golf",
        31 => "Climbing",
        35 => "Snowshoeing",
        37 => "Stand Up Paddleboarding",
        41 => "Kayaking",
        _ => "Other",
    }
}

fn estimate_moving_duration_seconds(samples: &[ActivitySample]) -> f64 {
    if samples.len() < 2 {
        return 0.0;
    }

    let mut moving_seconds = 0.0;

    for window in samples.windows(2) {
        let prev = &window[0];
        let current = &window[1];
        let dt = current.elapsed_seconds - prev.elapsed_seconds;

        if !(dt > 0.0 && dt <= MOVING_MAX_SAMPLE_GAP_SECONDS) {
            continue;
        }

        let segment_distance_m = match (prev.distance_m, current.distance_m) {
            (Some(a), Some(b)) if b >= a => Some(b - a),
            _ => match (prev.lat, prev.lon, current.lat, current.lon) {
                (Some(prev_lat), Some(prev_lon), Some(lat), Some(lon)) => {
                    Some(haversine_m(prev_lat, prev_lon, lat, lon))
                }
                _ => None,
            },
        };

        let segment_speed_mps = current.speed_mps.or_else(|| {
            segment_distance_m.and_then(|distance_m| {
                if dt > 0.0 {
                    Some(distance_m / dt)
                } else {
                    None
                }
            })
        });

        if segment_speed_mps
            .map(|speed| speed >= MOVING_SPEED_THRESHOLD_MPS)
            .unwrap_or(false)
        {
            moving_seconds += dt;
        }
    }

    moving_seconds.max(0.0)
}

fn build_distance_series(points: &[RawTrackPoint]) -> Vec<Option<f64>> {
    let first_reported_distance = points.iter().find_map(|point| point.distance);

    if let Some(first_distance) = first_reported_distance {
        let mut last_distance_m: f64 = 0.0;
        return points
            .iter()
            .map(|point| {
                if let Some(distance) = point.distance {
                    last_distance_m = last_distance_m.max((distance - first_distance).max(0.0));
                }
                Some(last_distance_m)
            })
            .collect();
    }

    let mut gps_distance_m = 0.0;
    let mut previous_gps: Option<(f64, f64)> = None;
    let mut has_seen_gps = false;

    points
        .iter()
        .map(|point| match (point.lat, point.lon) {
            (Some(lat), Some(lon)) => {
                if let Some((prev_lat, prev_lon)) = previous_gps {
                    gps_distance_m += haversine_m(prev_lat, prev_lon, lat, lon);
                }
                previous_gps = Some((lat, lon));
                has_seen_gps = true;
                Some(gps_distance_m)
            }
            _ if has_seen_gps => Some(gps_distance_m),
            _ => None,
        })
        .collect()
}

fn normalize_pause_segments(
    start_time: DateTime<Utc>,
    total_duration_seconds: f64,
    pause_spans: Vec<RawPauseSpan>,
) -> Vec<PauseSegment> {
    if pause_spans.is_empty() {
        return Vec::new();
    }

    let mut normalized: Vec<(f64, f64, Option<String>, Option<String>)> = pause_spans
        .into_iter()
        .filter_map(|span| {
            if span.end_time <= span.start_time {
                return None;
            }

            let start_elapsed = (span.start_time - start_time).num_milliseconds() as f64 / 1000.0;
            let end_elapsed = (span.end_time - start_time).num_milliseconds() as f64 / 1000.0;

            let mut start_elapsed = start_elapsed.max(0.0);
            let mut end_elapsed = end_elapsed.max(start_elapsed);
            if total_duration_seconds > 0.0 {
                start_elapsed = start_elapsed.min(total_duration_seconds);
                end_elapsed = end_elapsed.min(total_duration_seconds);
            }

            if end_elapsed <= start_elapsed {
                return None;
            }

            Some((
                start_elapsed,
                end_elapsed,
                Some(span.start_time.to_rfc3339()),
                Some(span.end_time.to_rfc3339()),
            ))
        })
        .collect();

    normalized.sort_by(|left, right| left.0.total_cmp(&right.0));

    let mut merged: Vec<PauseSegment> = Vec::new();
    for (start_elapsed, end_elapsed, start_timestamp, end_timestamp) in normalized {
        if let Some(previous) = merged.last_mut() {
            if start_elapsed <= previous.end_elapsed_seconds {
                previous.end_elapsed_seconds = previous.end_elapsed_seconds.max(end_elapsed);
                previous.duration_seconds =
                    (previous.end_elapsed_seconds - previous.start_elapsed_seconds).max(0.0);
                if previous.start_timestamp.is_none() {
                    previous.start_timestamp = start_timestamp;
                }
                previous.end_timestamp = end_timestamp;
                continue;
            }
        }

        merged.push(PauseSegment {
            start_elapsed_seconds: start_elapsed,
            end_elapsed_seconds: end_elapsed,
            duration_seconds: (end_elapsed - start_elapsed).max(0.0),
            start_timestamp,
            end_timestamp,
        });
    }

    merged
}

fn build_parsed_activity(
    path: &Path,
    points: Vec<RawTrackPoint>,
    sport_type: String,
    explicit_title: Option<String>,
    notes: Option<String>,
    activity_start: Option<DateTime<Utc>>,
    pause_spans: Vec<RawPauseSpan>,
    fallback_distance_m: f64,
    fallback_elapsed_duration_seconds: Option<f64>,
    fallback_moving_duration_seconds: Option<f64>,
    fallback_elevation_gain_m: Option<f64>,
) -> Result<ParsedActivity> {
    if points.is_empty() {
        return Err(ParseActivityError::NoTrackpoints(path.display().to_string()).into());
    }

    let first_time = points.iter().find_map(|point| point.time.as_ref().cloned());
    let last_time = points
        .iter()
        .rev()
        .find_map(|point| point.time.as_ref().cloned());

    let start_time = activity_start
        .or(first_time)
        .ok_or_else(|| anyhow!("missing activity start time in {}", path.display()))?;

    let duration_seconds = match (first_time, last_time) {
        (Some(start), Some(end)) if end >= start => {
            (end - start).num_milliseconds() as f64 / 1000.0
        }
        _ => fallback_elapsed_duration_seconds
            .or(fallback_moving_duration_seconds)
            .unwrap_or(0.0)
            .max(0.0),
    };

    let raw_distance_series = build_distance_series(&points);
    let raw_selected_distance_m = raw_distance_series
        .iter()
        .rev()
        .find_map(|distance| *distance)
        .unwrap_or(0.0)
        .max(0.0);
    let fallback_distance_m = fallback_distance_m.max(0.0);
    let should_reconcile_distance_total = fallback_distance_m > 0.0
        && raw_selected_distance_m > 0.0
        && ((fallback_distance_m - raw_selected_distance_m).abs()
            / fallback_distance_m.max(raw_selected_distance_m))
            > DISTANCE_TOTAL_RECONCILIATION_THRESHOLD_RATIO;
    let distance_scale = if should_reconcile_distance_total {
        fallback_distance_m / raw_selected_distance_m
    } else {
        1.0
    };
    let distance_series: Vec<Option<f64>> = raw_distance_series
        .iter()
        .map(|distance| distance.map(|value| value * distance_scale))
        .collect();
    let mut has_gps = false;

    let mut elevation_gain = 0.0;
    let mut previous_altitude: Option<f64> = None;

    let mut heart_rate_values: Vec<f64> = Vec::new();
    let mut speed_values: Vec<f64> = Vec::new();

    let mut previous_elapsed: Option<f64> = None;
    let mut previous_distance: Option<f64> = None;

    let mut raw_samples: Vec<ActivitySample> = Vec::with_capacity(points.len());
    let mut raw_track: Vec<TrackPoint> = Vec::with_capacity(points.len());

    for (index, point) in points.iter().enumerate() {
        if let (Some(lat), Some(lon)) = (point.lat, point.lon) {
            has_gps = true;
            raw_track.push(TrackPoint { lat, lon });
        }

        if let (Some(prev_alt), Some(current_alt)) = (previous_altitude, point.altitude) {
            let delta = current_alt - prev_alt;
            if delta > 0.0 {
                elevation_gain += delta;
            }
        }

        if point.altitude.is_some() {
            previous_altitude = point.altitude;
        }

        if let Some(hr) = point.heart_rate {
            heart_rate_values.push(hr);
        }

        let elapsed = point
            .time
            .as_ref()
            .map(|time| (*time - start_time).num_milliseconds() as f64 / 1000.0)
            .unwrap_or(0.0)
            .max(0.0);

        let distance_m = distance_series[index];

        let derived_speed = if let Some(speed) = point.speed {
            Some(speed)
        } else if let (Some(prev_elapsed), Some(prev_distance), Some(distance_m)) =
            (previous_elapsed, previous_distance, distance_m)
        {
            let dt = elapsed - prev_elapsed;
            if dt > 0.1 {
                Some(((distance_m - prev_distance) / dt).max(0.0))
            } else {
                None
            }
        } else {
            None
        };

        if let Some(speed) = derived_speed {
            speed_values.push(speed);
        }

        raw_samples.push(ActivitySample {
            elapsed_seconds: elapsed,
            distance_m,
            speed_mps: derived_speed,
            heart_rate: point.heart_rate,
            cadence: point.cadence,
            power_watts: point.power_watts,
            altitude_m: point.altitude,
            lat: point.lat,
            lon: point.lon,
            timestamp: point.time.as_ref().map(|time| time.to_rfc3339()),
        });

        previous_elapsed = Some(elapsed);
        previous_distance = distance_m;
    }

    let selected_distance_m = distance_series
        .iter()
        .rev()
        .find_map(|distance| *distance)
        .unwrap_or(0.0)
        .max(0.0);
    let distance_m = if fallback_distance_m > 0.0
        && (selected_distance_m <= 0.0 || should_reconcile_distance_total)
    {
        fallback_distance_m
    } else if selected_distance_m > 0.0 {
        selected_distance_m
    } else {
        fallback_distance_m
    };

    let max_speed_mps = speed_values.iter().copied().reduce(f64::max);

    let avg_hr = if heart_rate_values.is_empty() {
        None
    } else {
        Some(heart_rate_values.iter().sum::<f64>() / heart_rate_values.len() as f64)
    };

    let min_hr = heart_rate_values.iter().copied().reduce(f64::min);
    let max_hr = heart_rate_values.iter().copied().reduce(f64::max);

    let sampled_track = downsample(&raw_track, MAX_UI_POINTS);
    let estimated_moving_duration_seconds = estimate_moving_duration_seconds(&raw_samples);
    let moving_duration_seconds = fallback_moving_duration_seconds
        .filter(|value| *value > 0.0)
        .unwrap_or_else(|| {
            if estimated_moving_duration_seconds > 0.0 {
                estimated_moving_duration_seconds
            } else {
                duration_seconds
            }
        })
        .max(0.0);
    let moving_duration_seconds = if duration_seconds > 0.0 {
        moving_duration_seconds.min(duration_seconds)
    } else {
        moving_duration_seconds
    };
    let avg_speed_mps = if distance_m > 0.0 {
        let speed_duration_seconds = if moving_duration_seconds > 0.1 {
            moving_duration_seconds
        } else {
            duration_seconds
        };

        if speed_duration_seconds > 0.1 {
            Some(distance_m / speed_duration_seconds)
        } else if !speed_values.is_empty() {
            Some(speed_values.iter().sum::<f64>() / speed_values.len() as f64)
        } else {
            None
        }
    } else if !speed_values.is_empty() {
        Some(speed_values.iter().sum::<f64>() / speed_values.len() as f64)
    } else {
        None
    };
    let category = derive_activity_category(&sport_type, notes.as_deref());
    let title = derive_activity_title(
        path,
        &sport_type,
        &category,
        explicit_title.as_deref(),
        notes.as_deref(),
    );
    let pause_segments =
        normalize_pause_segments(start_time, duration_seconds.max(0.0), pause_spans);

    Ok(ParsedActivity {
        start_time: start_time.to_rfc3339(),
        title,
        category,
        sport_type,
        duration_seconds: duration_seconds.max(0.0),
        moving_duration_seconds,
        distance_m: distance_m.max(0.0),
        elevation_gain_m: fallback_elevation_gain_m.unwrap_or(elevation_gain).max(0.0),
        avg_speed_mps,
        max_speed_mps,
        avg_hr,
        min_hr,
        max_hr,
        has_gps,
        track: sampled_track,
        pause_segments,
        samples: raw_samples,
        original_sample_count: points.len(),
    })
}

fn build_summary_only_activity(
    path: &Path,
    sport_type: String,
    explicit_title: Option<String>,
    notes: Option<String>,
    activity_start: Option<DateTime<Utc>>,
    pause_spans: Vec<RawPauseSpan>,
    summary: SummaryMetrics,
) -> Result<ParsedActivity> {
    let start_time = activity_start
        .ok_or_else(|| anyhow!("missing activity start time in {}", path.display()))?;

    let category = derive_activity_category(&sport_type, notes.as_deref());
    let title = derive_activity_title(
        path,
        &sport_type,
        &category,
        explicit_title.as_deref(),
        notes.as_deref(),
    );

    let distance_m = summary.distance_m.max(0.0);
    let duration_seconds = summary
        .elapsed_duration_seconds
        .or(summary.timer_duration_seconds)
        .unwrap_or(0.0)
        .max(0.0);
    let moving_duration_seconds = summary
        .timer_duration_seconds
        .or(summary.elapsed_duration_seconds)
        .unwrap_or(duration_seconds)
        .max(0.0)
        .min(duration_seconds.max(0.0));
    let avg_speed_mps = summary.avg_speed_mps.or_else(|| {
        let speed_duration_seconds = if moving_duration_seconds > 0.1 {
            moving_duration_seconds
        } else {
            duration_seconds
        };
        if speed_duration_seconds > 0.1 && distance_m > 0.0 {
            Some(distance_m / speed_duration_seconds)
        } else {
            None
        }
    });
    let pause_segments = normalize_pause_segments(start_time, duration_seconds, pause_spans);

    Ok(ParsedActivity {
        start_time: start_time.to_rfc3339(),
        title,
        category,
        sport_type,
        duration_seconds,
        moving_duration_seconds,
        distance_m,
        elevation_gain_m: summary.elevation_gain_m.unwrap_or(0.0).max(0.0),
        avg_speed_mps,
        max_speed_mps: summary.max_speed_mps,
        avg_hr: summary.avg_hr,
        min_hr: summary.min_hr,
        max_hr: summary.max_hr,
        has_gps: false,
        track: Vec::new(),
        pause_segments,
        samples: Vec::new(),
        original_sample_count: 0,
    })
}

pub fn parse_activity_file(path: &Path) -> Result<ParsedActivity> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "tcx" | "txc" => parse_tcx_file(path),
        "fit" => parse_fit_file(path),
        _ => Err(anyhow!(
            "unsupported activity file type for {}",
            path.display()
        )),
    }
}

pub fn parse_tcx_file(path: &Path) -> Result<ParsedActivity> {
    let file =
        File::open(path).with_context(|| format!("failed to open TCX file {}", path.display()))?;
    let mut reader = Reader::from_reader(BufReader::new(file));
    reader.config_mut().trim_text(true);

    let mut buf = Vec::<u8>::new();
    let mut current_tag = String::new();

    let mut sport_type = String::from("Other");
    let explicit_title: Option<String> = None;
    let mut notes: Option<String> = None;
    let mut activity_start: Option<DateTime<Utc>> = None;

    let mut in_trackpoint = false;
    let mut in_position = false;
    let mut in_heart_rate = false;
    let mut in_lap = false;

    let mut lap_distance_total = 0.0;
    let mut lap_duration_total = 0.0;

    let mut current_point = RawTrackPoint::default();
    let mut points: Vec<RawTrackPoint> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = normalize_tag(e.name().as_ref());

                if tag == "Activity" {
                    for attr in e.attributes().flatten() {
                        if normalize_tag(attr.key.as_ref()) == "Sport" {
                            sport_type = String::from_utf8_lossy(attr.value.as_ref()).to_string();
                        }
                    }
                }

                if tag == "Lap" {
                    in_lap = true;
                    if activity_start.is_none() {
                        for attr in e.attributes().flatten() {
                            if normalize_tag(attr.key.as_ref()) == "StartTime" {
                                let value =
                                    String::from_utf8_lossy(attr.value.as_ref()).to_string();
                                activity_start = parse_time(&value);
                            }
                        }
                    }
                }

                if tag == "Trackpoint" {
                    in_trackpoint = true;
                    current_point = RawTrackPoint::default();
                }

                if tag == "Position" {
                    in_position = true;
                }

                if tag == "HeartRateBpm" {
                    in_heart_rate = true;
                }

                current_tag = tag;
            }
            Ok(Event::Text(e)) => {
                let value = String::from_utf8_lossy(e.as_ref()).trim().to_string();

                if value.is_empty() {
                    buf.clear();
                    continue;
                }

                if in_trackpoint {
                    match current_tag.as_str() {
                        "Time" => current_point.time = parse_time(&value),
                        "LatitudeDegrees" if in_position => current_point.lat = parse_f64(&value),
                        "LongitudeDegrees" if in_position => current_point.lon = parse_f64(&value),
                        "AltitudeMeters" => current_point.altitude = parse_f64(&value),
                        "DistanceMeters" => current_point.distance = parse_f64(&value),
                        "Speed" => current_point.speed = parse_f64(&value),
                        "Value" if in_heart_rate => current_point.heart_rate = parse_f64(&value),
                        "Cadence" | "RunCadence" => current_point.cadence = parse_f64(&value),
                        "Watts" => current_point.power_watts = parse_f64(&value),
                        _ => {}
                    }
                } else {
                    match current_tag.as_str() {
                        "Id" if activity_start.is_none() => activity_start = parse_time(&value),
                        "Notes" if notes.is_none() => notes = Some(value.clone()),
                        "TotalTimeSeconds" if in_lap => {
                            if let Some(v) = parse_f64(&value) {
                                lap_duration_total += v;
                            }
                        }
                        "DistanceMeters" if in_lap => {
                            if let Some(v) = parse_f64(&value) {
                                lap_distance_total += v;
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                let tag = normalize_tag(e.name().as_ref());

                if tag == "Trackpoint" {
                    in_trackpoint = false;
                    points.push(current_point.clone());
                }

                if tag == "Position" {
                    in_position = false;
                }

                if tag == "HeartRateBpm" {
                    in_heart_rate = false;
                }

                if tag == "Lap" {
                    in_lap = false;
                }

                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => {
                return Err(anyhow!(
                    "failed to parse XML in {}: {}",
                    path.display(),
                    err
                ));
            }
        }

        buf.clear();
    }

    build_parsed_activity(
        path,
        points,
        sport_type,
        explicit_title,
        notes,
        activity_start,
        Vec::new(),
        lap_distance_total,
        Some(lap_duration_total),
        None,
        None,
    )
}

pub fn parse_fit_file(path: &Path) -> Result<ParsedActivity> {
    let file =
        File::open(path).with_context(|| format!("failed to open FIT file {}", path.display()))?;
    let mut reader = BufReader::new(file);
    let records = fitparser::from_reader(&mut reader)
        .with_context(|| format!("failed to parse FIT {}", path.display()))?;

    let mut sport_type = String::from("Other");
    let mut sub_sport_type: Option<String> = None;
    let mut explicit_title: Option<String> = None;
    let mut notes: Option<String> = None;
    let mut activity_start: Option<DateTime<Utc>> = None;
    let mut summary = SummaryMetrics::default();
    let mut points: Vec<RawTrackPoint> = Vec::new();
    let mut pause_spans: Vec<RawPauseSpan> = Vec::new();
    let mut current_pause_start: Option<DateTime<Utc>> = None;

    for record in records {
        let kind = format!("{:?}", record.kind()).to_ascii_lowercase();

        if kind == "record" {
            let mut point = RawTrackPoint::default();

            for field in record.fields() {
                let name = field.name();
                let units = field.units();
                let value = field.value();

                match name {
                    "timestamp" => {
                        point.time = fit_value_as_time(value);
                    }
                    "position_lat" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            point.lat = Some(normalize_fit_position(name, units, v));
                        }
                    }
                    "position_long" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            point.lon = Some(normalize_fit_position(name, units, v));
                        }
                    }
                    "enhanced_altitude" if point.altitude.is_none() => {
                        point.altitude = fit_value_as_f64(value);
                    }
                    "altitude" => {
                        point.altitude = fit_value_as_f64(value);
                    }
                    "heart_rate" => {
                        point.heart_rate = fit_value_as_f64(value);
                    }
                    "cadence" | "enhanced_cadence" if point.cadence.is_none() => {
                        point.cadence = fit_value_as_f64(value);
                    }
                    "cadence" => {
                        point.cadence = fit_value_as_f64(value);
                    }
                    "power" | "enhanced_power" if point.power_watts.is_none() => {
                        point.power_watts = fit_value_as_f64(value);
                    }
                    "power" => {
                        point.power_watts = fit_value_as_f64(value);
                    }
                    "enhanced_speed" if point.speed.is_none() => {
                        point.speed = fit_value_as_f64(value);
                    }
                    "speed" => {
                        point.speed = fit_value_as_f64(value);
                    }
                    "distance" => {
                        point.distance = fit_value_as_f64(value);
                    }
                    _ => {}
                }
            }

            if point.time.is_some()
                || point.lat.is_some()
                || point.lon.is_some()
                || point.distance.is_some()
                || point.heart_rate.is_some()
                || point.cadence.is_some()
                || point.power_watts.is_some()
                || point.altitude.is_some()
            {
                points.push(point);
            }

            continue;
        }

        if kind == "event" {
            let mut event_name: Option<String> = None;
            let mut event_type: Option<String> = None;
            let mut timestamp: Option<DateTime<Utc>> = None;

            for field in record.fields() {
                let name = field.name();
                let value = field.value();

                match name {
                    "event" => {
                        event_name =
                            fit_value_as_string(value).map(|entry| entry.to_ascii_lowercase());
                    }
                    "event_type" => {
                        event_type =
                            fit_value_as_string(value).map(|entry| entry.to_ascii_lowercase());
                    }
                    "timestamp" => {
                        timestamp = fit_value_as_time(value);
                    }
                    _ => {}
                }
            }

            if event_name.as_deref() == Some("timer") {
                match (event_type.as_deref(), timestamp) {
                    (Some("start"), Some(timestamp)) => {
                        if let Some(pause_start) = current_pause_start.take() {
                            if timestamp > pause_start {
                                pause_spans.push(RawPauseSpan {
                                    start_time: pause_start,
                                    end_time: timestamp,
                                });
                            }
                        }
                    }
                    (Some("stop"), Some(timestamp))
                    | (Some("stop_all"), Some(timestamp))
                    | (Some("stop_disable_all"), Some(timestamp)) => {
                        current_pause_start.get_or_insert(timestamp);
                    }
                    _ => {}
                }
            }

            continue;
        }

        if kind == "session" || kind == "activity" || kind == "sport" || kind == "workout" {
            for field in record.fields() {
                let name = field.name();
                let value = field.value();

                match name {
                    "sport" => {
                        if let Some(label) = fit_value_as_string(value) {
                            sport_type = label;
                        } else if let Some(code) = fit_value_as_u8(value) {
                            sport_type = fit_sport_code_to_name(code).to_string();
                        }
                    }
                    "sub_sport" if sport_type == "Other" => {
                        if let Some(label) = fit_value_as_string(value) {
                            sub_sport_type = Some(label);
                        }
                    }
                    "sub_sport" => {
                        if let Some(label) = fit_value_as_string(value) {
                            sub_sport_type = Some(label);
                        }
                    }
                    "workout_name" | "wkt_name" | "session_name" | "sport_profile_name"
                        if explicit_title.is_none() =>
                    {
                        explicit_title = fit_value_as_string(value);
                    }
                    "notes" if notes.is_none() => {
                        notes = fit_value_as_string(value);
                    }
                    "start_time" | "timestamp" if activity_start.is_none() => {
                        activity_start = fit_value_as_time(value);
                    }
                    "total_distance" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.distance_m = summary.distance_m.max(v);
                        }
                    }
                    "total_elapsed_time" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.elapsed_duration_seconds =
                                Some(summary.elapsed_duration_seconds.map_or(v, |cur| cur.max(v)));
                        }
                    }
                    "total_timer_time" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.timer_duration_seconds =
                                Some(summary.timer_duration_seconds.map_or(v, |cur| cur.max(v)));
                        }
                    }
                    "total_ascent" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.elevation_gain_m =
                                Some(summary.elevation_gain_m.map_or(v, |cur| cur.max(v)));
                        }
                    }
                    "enhanced_avg_speed" | "avg_speed" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.avg_speed_mps = Some(summary.avg_speed_mps.map_or(v, |cur| {
                                if cur > 0.0 {
                                    cur
                                } else {
                                    v
                                }
                            }));
                        }
                    }
                    "enhanced_max_speed" | "max_speed" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.max_speed_mps =
                                Some(summary.max_speed_mps.map_or(v, |cur| cur.max(v)));
                        }
                    }
                    "avg_heart_rate" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.avg_hr = Some(v);
                        }
                    }
                    "min_heart_rate" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.min_hr = Some(summary.min_hr.map_or(v, |cur| cur.min(v)));
                        }
                    }
                    "max_heart_rate" => {
                        if let Some(v) = fit_value_as_f64(value) {
                            summary.max_hr = Some(summary.max_hr.map_or(v, |cur| cur.max(v)));
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(sub_sport) = sub_sport_type
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let sub_sport = sub_sport.to_string();
        sport_type = if sport_type == "Other" {
            sub_sport
        } else if sport_type.eq_ignore_ascii_case(&sub_sport) {
            sport_type
        } else {
            format!("{sport_type} {sub_sport}")
        };
    }

    if points.is_empty() {
        return build_summary_only_activity(
            path,
            sport_type,
            explicit_title,
            notes,
            activity_start,
            pause_spans,
            summary,
        );
    }

    build_parsed_activity(
        path,
        points,
        sport_type,
        explicit_title,
        notes,
        activity_start,
        pause_spans,
        summary.distance_m,
        summary.elapsed_duration_seconds,
        summary.timer_duration_seconds,
        summary.elevation_gain_m,
    )
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::{build_parsed_activity, derive_activity_category, RawPauseSpan, RawTrackPoint};

    #[test]
    fn hiking_generic_maps_to_hiking_category() {
        assert_eq!(derive_activity_category("hiking generic", None), "Hiking");
    }

    #[test]
    fn reported_distance_stays_consistent_when_tail_samples_drop_distance() {
        let start_time = chrono::Utc.with_ymd_and_hms(2026, 4, 7, 8, 0, 0).unwrap();
        let points = vec![
            RawTrackPoint {
                time: Some(start_time),
                distance: Some(10.0),
                lat: Some(46.0),
                lon: Some(8.0),
                ..Default::default()
            },
            RawTrackPoint {
                time: Some(start_time + chrono::Duration::seconds(10)),
                distance: Some(20.0),
                lat: Some(46.0001),
                lon: Some(8.0001),
                ..Default::default()
            },
            RawTrackPoint {
                time: Some(start_time + chrono::Duration::seconds(20)),
                lat: Some(46.005),
                lon: Some(8.005),
                ..Default::default()
            },
        ];

        let parsed = build_parsed_activity(
            std::path::Path::new("sample.fit"),
            points,
            "Hiking".to_string(),
            None,
            None,
            Some(start_time),
            vec![RawPauseSpan {
                start_time: start_time + chrono::Duration::seconds(12),
                end_time: start_time + chrono::Duration::seconds(18),
            }],
            0.0,
            Some(20.0),
            Some(14.0),
            None,
        )
        .expect("activity should parse");

        assert_eq!(parsed.distance_m, 10.0);
        assert_eq!(parsed.samples.len(), 3);
        assert_eq!(parsed.samples[1].distance_m, Some(10.0));
        assert_eq!(parsed.samples[2].distance_m, Some(10.0));
        assert_eq!(parsed.pause_segments.len(), 1);
        assert_eq!(parsed.pause_segments[0].start_elapsed_seconds, 12.0);
        assert_eq!(parsed.pause_segments[0].end_elapsed_seconds, 18.0);
    }

    #[test]
    fn summary_distance_reconciles_sample_distance_when_totals_disagree() {
        let start_time = chrono::Utc.with_ymd_and_hms(2026, 4, 7, 8, 0, 0).unwrap();
        let points = vec![
            RawTrackPoint {
                time: Some(start_time),
                distance: Some(0.0),
                ..Default::default()
            },
            RawTrackPoint {
                time: Some(start_time + chrono::Duration::seconds(10)),
                distance: Some(50.0),
                ..Default::default()
            },
            RawTrackPoint {
                time: Some(start_time + chrono::Duration::seconds(20)),
                distance: Some(100.0),
                ..Default::default()
            },
        ];

        let parsed = build_parsed_activity(
            std::path::Path::new("sample.fit"),
            points,
            "Hiking".to_string(),
            None,
            None,
            Some(start_time),
            Vec::new(),
            200.0,
            Some(20.0),
            Some(20.0),
            None,
        )
        .expect("activity should parse");

        assert_eq!(parsed.distance_m, 200.0);
        assert_eq!(parsed.samples[1].distance_m, Some(100.0));
        assert_eq!(parsed.samples[2].distance_m, Some(200.0));
    }
}
