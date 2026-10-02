use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::Result;
use chrono::{Datelike, Duration, Local, NaiveDate};
use rusqlite::Connection;

use crate::{
    db,
    models::{
        ActivityFilters, ActivitySample, ActivitySummary, AdvancedAnalyticsActivityCondition,
        AdvancedAnalyticsActivityConditionField, AdvancedAnalyticsActivityConditionOperator,
        AdvancedAnalyticsBaseMeasure, AdvancedAnalyticsBaseMetricDefinition,
        AdvancedAnalyticsBucketPoint, AdvancedAnalyticsChartBucketPoint,
        AdvancedAnalyticsChartDefinition, AdvancedAnalyticsChartResult, AdvancedAnalyticsChartType,
        AdvancedAnalyticsConditionJoin, AdvancedAnalyticsFormulaMetricDefinition,
        AdvancedAnalyticsFormulaOperator, AdvancedAnalyticsGranularity,
        AdvancedAnalyticsMetricDefinition, AdvancedAnalyticsMetricKind,
        AdvancedAnalyticsMetricResult, AdvancedAnalyticsPeriod, AdvancedAnalyticsRunRequest,
        AdvancedAnalyticsRunResponse, AdvancedAnalyticsSampleCondition,
        AdvancedAnalyticsSampleConditionField, AdvancedAnalyticsSampleConditionOperator,
        AdvancedAnalyticsSampleTimeActivityPreview, AdvancedAnalyticsSampleTimePreview,
        AdvancedAnalyticsSampleTimeSegment, AdvancedAnalyticsSampleTimeSegmentStatus,
        AdvancedAnalyticsSeriesByGranularity, AdvancedAnalyticsStreakDefinition,
        AdvancedAnalyticsStreakResult, AdvancedAnalyticsStreakStatus,
        AdvancedAnalyticsThresholdOperator,
    },
};

#[derive(Debug, Clone)]
struct BucketValue {
    label: String,
    value: Option<f64>,
}

type BucketSeries = BTreeMap<String, BucketValue>;

#[derive(Debug, Clone, Copy)]
struct SeriesFillRange {
    start: NaiveDate,
    end: NaiveDate,
}

#[derive(Debug, Clone)]
struct InternalMetricResult {
    metric_id: String,
    name: String,
    scalar_value: Option<f64>,
    unit: Option<String>,
    value_unit: Option<String>,
    day: BucketSeries,
    week: BucketSeries,
    month: BucketSeries,
    sample_time_preview: Option<AdvancedAnalyticsSampleTimePreview>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct SampleTimeComputation {
    included_seconds: f64,
    filtered_out_seconds: f64,
    total_tracked_seconds: f64,
    segments: Vec<AdvancedAnalyticsSampleTimeSegment>,
}

pub fn run_advanced_analytics(
    conn: &Connection,
    request: &AdvancedAnalyticsRunRequest,
    heart_rate_zone_upper_bounds_bpm: &[u16],
) -> Result<AdvancedAnalyticsRunResponse> {
    let activities = db::list_activities(
        conn,
        &ActivityFilters {
            start_date: request.start_date.clone(),
            end_date: request.end_date.clone(),
            category: None,
            sport_type: None,
            min_distance: None,
            max_distance: None,
            day: None,
        },
    )?;

    let metric_defs: HashMap<String, AdvancedAnalyticsMetricDefinition> = request
        .metrics
        .iter()
        .cloned()
        .map(|metric| (metric.id.clone(), metric))
        .collect();

    let mut sample_cache: HashMap<i64, Vec<ActivitySample>> = HashMap::new();
    let mut metric_cache: HashMap<String, InternalMetricResult> = HashMap::new();
    let mut metric_visit_state: HashMap<String, VisitState> = HashMap::new();

    let mut global_warnings = Vec::new();
    if metric_defs.len() != request.metrics.len() {
        global_warnings
            .push("Duplicate metric IDs detected; later duplicates were ignored.".to_string());
    }

    for metric in &request.metrics {
        compute_metric(
            &metric.id,
            &metric_defs,
            &activities,
            conn,
            &mut sample_cache,
            &mut metric_cache,
            &mut metric_visit_state,
            heart_rate_zone_upper_bounds_bpm,
        )?;
    }

    if let Some(fill_range) = infer_series_fill_range(request, &activities) {
        for metric in metric_cache.values_mut() {
            fill_metric_series_gaps(metric, fill_range);
        }
    }

    let streak_results = build_streak_results(&request.streaks, &metric_cache);
    let chart_results = build_chart_results(&request.charts, &metric_cache);

    let metric_results = metric_cache
        .into_iter()
        .map(|(id, internal)| (id, finalize_metric(internal)))
        .collect();

    Ok(AdvancedAnalyticsRunResponse {
        metric_results,
        streak_results,
        chart_results,
        global_warnings,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VisitState {
    Visiting,
    Done,
}

#[allow(clippy::too_many_arguments)]
fn compute_metric(
    metric_id: &str,
    metric_defs: &HashMap<String, AdvancedAnalyticsMetricDefinition>,
    activities: &[ActivitySummary],
    conn: &Connection,
    sample_cache: &mut HashMap<i64, Vec<ActivitySample>>,
    metric_cache: &mut HashMap<String, InternalMetricResult>,
    visit_state: &mut HashMap<String, VisitState>,
    hr_zone_upper_bounds: &[u16],
) -> Result<()> {
    if metric_cache.contains_key(metric_id) {
        return Ok(());
    }

    if matches!(visit_state.get(metric_id), Some(VisitState::Visiting)) {
        metric_cache.insert(
            metric_id.to_string(),
            error_metric(metric_id, metric_id, "Metric formula cycle detected."),
        );
        return Ok(());
    }

    let Some(metric) = metric_defs.get(metric_id) else {
        metric_cache.insert(
            metric_id.to_string(),
            error_metric(metric_id, metric_id, "Metric definition not found."),
        );
        return Ok(());
    };

    visit_state.insert(metric_id.to_string(), VisitState::Visiting);

    let computed = match metric.kind {
        AdvancedAnalyticsMetricKind::Base => {
            if let Some(base) = &metric.base {
                compute_base_metric(
                    metric,
                    base,
                    activities,
                    conn,
                    sample_cache,
                    hr_zone_upper_bounds,
                )?
            } else {
                error_metric(
                    &metric.id,
                    &metric.name,
                    "Missing base metric configuration.",
                )
            }
        }
        AdvancedAnalyticsMetricKind::Formula => {
            if let Some(formula) = &metric.formula {
                compute_metric(
                    &formula.left_metric_id,
                    metric_defs,
                    activities,
                    conn,
                    sample_cache,
                    metric_cache,
                    visit_state,
                    hr_zone_upper_bounds,
                )?;
                compute_metric(
                    &formula.right_metric_id,
                    metric_defs,
                    activities,
                    conn,
                    sample_cache,
                    metric_cache,
                    visit_state,
                    hr_zone_upper_bounds,
                )?;

                let left = metric_cache.get(&formula.left_metric_id).cloned();
                let right = metric_cache.get(&formula.right_metric_id).cloned();
                compute_formula_metric(metric, formula, left, right)
            } else {
                error_metric(
                    &metric.id,
                    &metric.name,
                    "Missing formula metric configuration.",
                )
            }
        }
    };

    visit_state.insert(metric_id.to_string(), VisitState::Done);
    metric_cache.insert(metric_id.to_string(), computed);
    Ok(())
}

fn infer_series_fill_range(
    request: &AdvancedAnalyticsRunRequest,
    activities: &[ActivitySummary],
) -> Option<SeriesFillRange> {
    let request_start = request.start_date.as_deref().and_then(parse_activity_day);
    let request_end = request.end_date.as_deref().and_then(parse_activity_day);

    let mut activity_dates = activities
        .iter()
        .filter_map(|activity| parse_activity_day(&activity.activity_start));
    let activity_min = activity_dates.next().map(|first| {
        activity_dates.fold((first, first), |(min_date, max_date), date| {
            (min_date.min(date), max_date.max(date))
        })
    });

    let (activity_start, activity_end) = activity_min
        .map(|(min_date, max_date)| (Some(min_date), Some(max_date)))
        .unwrap_or((None, None));

    let start = request_start.or(activity_start)?;
    let end = request_end.or(activity_end)?;

    Some(if start <= end {
        SeriesFillRange { start, end }
    } else {
        SeriesFillRange {
            start: end,
            end: start,
        }
    })
}

fn error_metric(metric_id: &str, name: &str, message: &str) -> InternalMetricResult {
    InternalMetricResult {
        metric_id: metric_id.to_string(),
        name: name.to_string(),
        scalar_value: None,
        unit: None,
        value_unit: None,
        day: BTreeMap::new(),
        week: BTreeMap::new(),
        month: BTreeMap::new(),
        sample_time_preview: None,
        errors: vec![message.to_string()],
        warnings: Vec::new(),
    }
}

fn compute_formula_metric(
    metric: &AdvancedAnalyticsMetricDefinition,
    formula: &AdvancedAnalyticsFormulaMetricDefinition,
    left: Option<InternalMetricResult>,
    right: Option<InternalMetricResult>,
) -> InternalMetricResult {
    let display_unit_override = normalized_unit_option(formula.display_unit.as_deref());
    let mut result = InternalMetricResult {
        metric_id: metric.id.clone(),
        name: metric.name.clone(),
        scalar_value: None,
        unit: display_unit_override.clone(),
        value_unit: None,
        day: BTreeMap::new(),
        week: BTreeMap::new(),
        month: BTreeMap::new(),
        sample_time_preview: None,
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    let Some(left) = left else {
        result.errors.push(format!(
            "Left metric '{}' not found.",
            formula.left_metric_id
        ));
        return result;
    };
    let Some(mut right) = right else {
        result.errors.push(format!(
            "Right metric '{}' not found.",
            formula.right_metric_id
        ));
        return result;
    };

    if !left.errors.is_empty() {
        result
            .warnings
            .push(format!("Left metric '{}' has errors.", left.name));
    }
    if !right.errors.is_empty() {
        result
            .warnings
            .push(format!("Right metric '{}' has errors.", right.name));
    }

    result.value_unit = match formula.operator {
        AdvancedAnalyticsFormulaOperator::Add | AdvancedAnalyticsFormulaOperator::Subtract => {
            align_formula_units_for_add_subtract(&left, &mut right, &mut result.warnings)
        }
        AdvancedAnalyticsFormulaOperator::Divide => infer_division_value_unit(
            left.value_unit.as_deref().or(left.unit.as_deref()),
            right.value_unit.as_deref().or(right.unit.as_deref()),
        ),
        AdvancedAnalyticsFormulaOperator::Percent => Some("%".to_string()),
    };

    result.scalar_value = apply_formula(formula.operator, left.scalar_value, right.scalar_value);
    result.day = combine_series_with_formula(formula.operator, &left.day, &right.day);
    result.week = combine_series_with_formula(formula.operator, &left.week, &right.week);
    result.month = combine_series_with_formula(formula.operator, &left.month, &right.month);

    if result.unit.is_none() {
        result.unit = result
            .value_unit
            .clone()
            .or_else(|| left.unit.clone().or(right.unit.clone()));
    }
    let output_unit = result.unit.clone();
    apply_display_unit_conversion(&mut result, output_unit);

    result
}

fn apply_formula(
    operator: AdvancedAnalyticsFormulaOperator,
    left: Option<f64>,
    right: Option<f64>,
) -> Option<f64> {
    let (Some(left), Some(right)) = (left, right) else {
        return None;
    };
    match operator {
        AdvancedAnalyticsFormulaOperator::Add => Some(left + right),
        AdvancedAnalyticsFormulaOperator::Subtract => Some(left - right),
        AdvancedAnalyticsFormulaOperator::Divide => {
            if right.abs() < f64::EPSILON {
                None
            } else {
                Some(left / right)
            }
        }
        AdvancedAnalyticsFormulaOperator::Percent => {
            if right.abs() < f64::EPSILON {
                None
            } else {
                Some((left / right) * 100.0)
            }
        }
    }
}

fn combine_series_with_formula(
    operator: AdvancedAnalyticsFormulaOperator,
    left: &BucketSeries,
    right: &BucketSeries,
) -> BucketSeries {
    let mut output = BTreeMap::new();
    let mut keys = BTreeMap::<String, String>::new();

    for (key, value) in left {
        keys.insert(key.clone(), value.label.clone());
    }
    for (key, value) in right {
        keys.entry(key.clone())
            .or_insert_with(|| value.label.clone());
    }

    for (key, label) in keys {
        let left_value = left.get(&key).and_then(|v| v.value);
        let right_value = right.get(&key).and_then(|v| v.value);
        output.insert(
            key,
            BucketValue {
                label,
                value: apply_formula(operator, left_value, right_value),
            },
        );
    }

    output
}

fn compute_base_metric(
    metric: &AdvancedAnalyticsMetricDefinition,
    base: &AdvancedAnalyticsBaseMetricDefinition,
    activities: &[ActivitySummary],
    conn: &Connection,
    sample_cache: &mut HashMap<i64, Vec<ActivitySample>>,
    hr_zone_upper_bounds: &[u16],
) -> Result<InternalMetricResult> {
    let display_unit_override = normalized_unit_option(base.display_unit.as_deref());
    let source_unit = default_unit_for_measure(base.measure).map(ToString::to_string);
    let display_unit = display_unit_override.or_else(|| source_unit.clone());
    let mut result = InternalMetricResult {
        metric_id: metric.id.clone(),
        name: metric.name.clone(),
        scalar_value: Some(0.0),
        unit: display_unit.clone(),
        value_unit: source_unit,
        day: BTreeMap::new(),
        week: BTreeMap::new(),
        month: BTreeMap::new(),
        sample_time_preview: None,
        errors: Vec::new(),
        warnings: Vec::new(),
    };
    let activity_condition_groups = normalized_activity_condition_groups(base);
    let sample_condition_groups = normalized_sample_condition_groups(base);
    let minimum_sample_match_seconds =
        normalized_minimum_sample_match_seconds(base.minimum_sample_match_seconds);

    let matched: Vec<&ActivitySummary> = activities
        .iter()
        .filter(|activity| activity_matches_condition_groups(activity, &activity_condition_groups))
        .collect();

    match base.measure {
        AdvancedAnalyticsBaseMeasure::ActivitiesCount
        | AdvancedAnalyticsBaseMeasure::DistanceSum
        | AdvancedAnalyticsBaseMeasure::DurationSum
        | AdvancedAnalyticsBaseMeasure::MovingTimeSum
        | AdvancedAnalyticsBaseMeasure::ElevationGainSum => {
            let mut scalar = 0.0;
            for activity in matched {
                let Some(date) = parse_activity_day(&activity.activity_start) else {
                    continue;
                };
                let value = base_measure_activity_value(base.measure, activity);
                scalar += value;
                add_bucket_value(
                    &mut result.day,
                    date,
                    AdvancedAnalyticsGranularity::Day,
                    value,
                );
                add_bucket_value(
                    &mut result.week,
                    date,
                    AdvancedAnalyticsGranularity::Week,
                    value,
                );
                add_bucket_value(
                    &mut result.month,
                    date,
                    AdvancedAnalyticsGranularity::Month,
                    value,
                );
            }
            result.scalar_value = Some(scalar);
        }
        AdvancedAnalyticsBaseMeasure::ActiveDaysCount => {
            let mut scalar_days = HashSet::new();
            let mut by_day_bucket: HashMap<String, HashSet<String>> = HashMap::new();
            let mut by_week_bucket: HashMap<String, HashSet<String>> = HashMap::new();
            let mut by_month_bucket: HashMap<String, HashSet<String>> = HashMap::new();

            for activity in matched {
                let Some(date) = parse_activity_day(&activity.activity_start) else {
                    continue;
                };
                let day_key = date.format("%Y-%m-%d").to_string();
                scalar_days.insert(day_key.clone());

                let (bucket_key, _) = bucket_key_and_label(date, AdvancedAnalyticsGranularity::Day);
                by_day_bucket
                    .entry(bucket_key)
                    .or_default()
                    .insert(day_key.clone());
                let (bucket_key, _) =
                    bucket_key_and_label(date, AdvancedAnalyticsGranularity::Week);
                by_week_bucket
                    .entry(bucket_key)
                    .or_default()
                    .insert(day_key.clone());
                let (bucket_key, _) =
                    bucket_key_and_label(date, AdvancedAnalyticsGranularity::Month);
                by_month_bucket
                    .entry(bucket_key)
                    .or_default()
                    .insert(day_key);
            }

            result.scalar_value = Some(scalar_days.len() as f64);
            result.day = set_counts_to_series(&by_day_bucket, AdvancedAnalyticsGranularity::Day);
            result.week = set_counts_to_series(&by_week_bucket, AdvancedAnalyticsGranularity::Week);
            result.month =
                set_counts_to_series(&by_month_bucket, AdvancedAnalyticsGranularity::Month);
        }
        AdvancedAnalyticsBaseMeasure::SampleTime => {
            let mut scalar = 0.0;
            let mut preview_activities = Vec::new();
            if sample_condition_groups.is_empty() {
                result
                    .warnings
                    .push("Sample time metric has no sample conditions; counting all tracked sample intervals.".to_string());
            }
            for activity in &matched {
                let Some(date) = parse_activity_day(&activity.activity_start) else {
                    continue;
                };
                if !sample_cache.contains_key(&activity.id) {
                    sample_cache.insert(
                        activity.id,
                        db::get_all_activity_samples(conn, activity.id)?,
                    );
                }
                let samples = sample_cache
                    .get(&activity.id)
                    .expect("sample cache populated");
                let sample_time = compute_matching_sample_time(
                    samples,
                    &sample_condition_groups,
                    hr_zone_upper_bounds,
                    minimum_sample_match_seconds,
                );
                scalar += sample_time.included_seconds;
                add_bucket_value(
                    &mut result.day,
                    date,
                    AdvancedAnalyticsGranularity::Day,
                    sample_time.included_seconds,
                );
                add_bucket_value(
                    &mut result.week,
                    date,
                    AdvancedAnalyticsGranularity::Week,
                    sample_time.included_seconds,
                );
                add_bucket_value(
                    &mut result.month,
                    date,
                    AdvancedAnalyticsGranularity::Month,
                    sample_time.included_seconds,
                );
                preview_activities.push(AdvancedAnalyticsSampleTimeActivityPreview {
                    activity_id: activity.id,
                    activity_start: activity.activity_start.clone(),
                    activity_title: activity.title.clone(),
                    total_tracked_seconds: sample_time.total_tracked_seconds,
                    included_seconds: sample_time.included_seconds,
                    filtered_out_seconds: sample_time.filtered_out_seconds,
                    segments: sample_time.segments,
                });
            }
            result.scalar_value = Some(scalar);
            result.sample_time_preview = Some(AdvancedAnalyticsSampleTimePreview {
                minimum_continuous_match_seconds: minimum_sample_match_seconds,
                considered_activity_count: matched.len(),
                sampled_activity_count: preview_activities.len(),
                activities: preview_activities,
            });
        }
    }

    if base.measure != AdvancedAnalyticsBaseMeasure::SampleTime
        && !sample_condition_groups.is_empty()
    {
        result
            .warnings
            .push("Sample conditions are ignored unless measure is Sample time.".to_string());
    }
    if base.measure != AdvancedAnalyticsBaseMeasure::SampleTime
        && minimum_sample_match_seconds > 0.0
    {
        result.warnings.push(
            "Minimum continuous sample match time is ignored unless measure is Sample time."
                .to_string(),
        );
    }

    apply_display_unit_conversion(&mut result, display_unit);

    Ok(result)
}

fn normalized_minimum_sample_match_seconds(value: Option<f64>) -> f64 {
    value
        .filter(|candidate| candidate.is_finite())
        .map(|candidate| candidate.max(0.0))
        .unwrap_or(0.0)
}

fn normalized_unit_option(unit: Option<&str>) -> Option<String> {
    unit.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalized_unit_key(unit: &str) -> String {
    match unit.trim().to_lowercase().as_str() {
        "sec" | "second" | "seconds" => "s".to_string(),
        "mins" | "minute" | "minutes" => "min".to_string(),
        "hour" | "hours" | "hr" | "hrs" => "h".to_string(),
        "meter" | "meters" => "m".to_string(),
        "kilometer" | "kilometers" => "km".to_string(),
        "mile" | "miles" => "mi".to_string(),
        "kmh" | "kph" => "km/h".to_string(),
        "mps" => "m/s".to_string(),
        "mph" => "mi/h".to_string(),
        other => other.to_string(),
    }
}

fn distance_to_meters_factor(unit_key: &str) -> Option<f64> {
    match unit_key {
        "m" => Some(1.0),
        "km" => Some(1000.0),
        "mi" => Some(1609.344),
        _ => None,
    }
}

fn duration_to_seconds_factor(unit_key: &str) -> Option<f64> {
    match unit_key {
        "s" => Some(1.0),
        "min" => Some(60.0),
        "h" => Some(3600.0),
        _ => None,
    }
}

fn speed_to_mps_factor(unit_key: &str) -> Option<f64> {
    match unit_key {
        "m/s" => Some(1.0),
        "km/h" => Some(1000.0 / 3600.0),
        "mi/h" => Some(1609.344 / 3600.0),
        _ => None,
    }
}

fn unit_multiplier(from_key: &str, to_key: &str) -> Option<f64> {
    if from_key == to_key {
        return Some(1.0);
    }
    if let (Some(from), Some(to)) = (
        distance_to_meters_factor(from_key),
        distance_to_meters_factor(to_key),
    ) {
        return Some(from / to);
    }
    if let (Some(from), Some(to)) = (
        duration_to_seconds_factor(from_key),
        duration_to_seconds_factor(to_key),
    ) {
        return Some(from / to);
    }
    if let (Some(from), Some(to)) = (speed_to_mps_factor(from_key), speed_to_mps_factor(to_key)) {
        return Some(from / to);
    }
    None
}

fn apply_series_multiplier(series: &mut BucketSeries, multiplier: f64) {
    for point in series.values_mut() {
        point.value = point.value.map(|value| value * multiplier);
    }
}

fn apply_metric_multiplier(metric: &mut InternalMetricResult, multiplier: f64) {
    metric.scalar_value = metric.scalar_value.map(|value| value * multiplier);
    apply_series_multiplier(&mut metric.day, multiplier);
    apply_series_multiplier(&mut metric.week, multiplier);
    apply_series_multiplier(&mut metric.month, multiplier);
}

fn apply_display_unit_conversion(metric: &mut InternalMetricResult, display_unit: Option<String>) {
    let Some(target_unit) = display_unit.and_then(|unit| normalized_unit_option(Some(&unit)))
    else {
        return;
    };
    metric.unit = Some(target_unit.clone());
    let target_key = normalized_unit_key(&target_unit);

    let Some(source_unit) = metric.value_unit.clone() else {
        // Dimensionless ratios (for example from divide formulas) should scale to percent when
        // '%' is selected as the display unit.
        if target_key == "%" {
            apply_metric_multiplier(metric, 100.0);
            metric.value_unit = Some(target_unit);
        }
        return;
    };
    let source_key = normalized_unit_key(&source_unit);

    let Some(multiplier) = unit_multiplier(&source_key, &target_key) else {
        if source_key != target_key {
            metric.warnings.push(format!(
                "Cannot convert values from '{}' to '{}'; using raw values.",
                source_unit, target_unit
            ));
        }
        return;
    };

    if (multiplier - 1.0).abs() > f64::EPSILON {
        apply_metric_multiplier(metric, multiplier);
    }
    metric.value_unit = Some(target_unit);
}

fn align_formula_units_for_add_subtract(
    left: &InternalMetricResult,
    right: &mut InternalMetricResult,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let left_unit = left
        .value_unit
        .as_deref()
        .or(left.unit.as_deref())
        .and_then(|unit| normalized_unit_option(Some(unit)));
    let right_unit = right
        .value_unit
        .as_deref()
        .or(right.unit.as_deref())
        .and_then(|unit| normalized_unit_option(Some(unit)));

    match (left_unit, right_unit) {
        (Some(left_unit), Some(right_unit)) => {
            let left_key = normalized_unit_key(&left_unit);
            let right_key = normalized_unit_key(&right_unit);
            if let Some(multiplier) = unit_multiplier(&right_key, &left_key) {
                if (multiplier - 1.0).abs() > f64::EPSILON {
                    apply_metric_multiplier(right, multiplier);
                }
                right.value_unit = Some(left_unit.clone());
            } else {
                warnings.push(format!(
                    "Formula operands use incompatible units ('{}' and '{}'); operation used raw values.",
                    left_unit, right_unit
                ));
            }
            Some(left_unit)
        }
        (Some(left_unit), None) => Some(left_unit),
        (None, Some(right_unit)) => Some(right_unit),
        (None, None) => None,
    }
}

fn infer_division_value_unit(left_unit: Option<&str>, right_unit: Option<&str>) -> Option<String> {
    let left_key = normalized_unit_option(left_unit).map(|unit| normalized_unit_key(&unit))?;
    let right_key = normalized_unit_option(right_unit).map(|unit| normalized_unit_key(&unit))?;

    match (left_key.as_str(), right_key.as_str()) {
        ("m", "s") => Some("m/s".to_string()),
        ("km", "h") => Some("km/h".to_string()),
        ("mi", "h") => Some("mi/h".to_string()),
        _ => None,
    }
}

fn default_unit_for_measure(measure: AdvancedAnalyticsBaseMeasure) -> Option<&'static str> {
    match measure {
        AdvancedAnalyticsBaseMeasure::ActivitiesCount
        | AdvancedAnalyticsBaseMeasure::ActiveDaysCount => Some("count"),
        AdvancedAnalyticsBaseMeasure::DistanceSum => Some("m"),
        AdvancedAnalyticsBaseMeasure::DurationSum
        | AdvancedAnalyticsBaseMeasure::MovingTimeSum
        | AdvancedAnalyticsBaseMeasure::SampleTime => Some("s"),
        AdvancedAnalyticsBaseMeasure::ElevationGainSum => Some("m"),
    }
}

fn base_measure_activity_value(
    measure: AdvancedAnalyticsBaseMeasure,
    activity: &ActivitySummary,
) -> f64 {
    match measure {
        AdvancedAnalyticsBaseMeasure::ActivitiesCount => 1.0,
        AdvancedAnalyticsBaseMeasure::DistanceSum => activity.distance_m.max(0.0),
        AdvancedAnalyticsBaseMeasure::DurationSum => activity.duration_seconds.max(0.0),
        AdvancedAnalyticsBaseMeasure::MovingTimeSum => activity.moving_duration_seconds.max(0.0),
        AdvancedAnalyticsBaseMeasure::ElevationGainSum => activity.elevation_gain_m.max(0.0),
        AdvancedAnalyticsBaseMeasure::ActiveDaysCount
        | AdvancedAnalyticsBaseMeasure::SampleTime => 0.0,
    }
}

fn set_counts_to_series(
    buckets: &HashMap<String, HashSet<String>>,
    granularity: AdvancedAnalyticsGranularity,
) -> BucketSeries {
    let mut output = BTreeMap::new();
    for (key, set) in buckets {
        let label = bucket_label_from_key(key, granularity);
        output.insert(
            key.clone(),
            BucketValue {
                label,
                value: Some(set.len() as f64),
            },
        );
    }
    output
}

fn add_bucket_value(
    series: &mut BucketSeries,
    date: NaiveDate,
    granularity: AdvancedAnalyticsGranularity,
    delta: f64,
) {
    let (key, label) = bucket_key_and_label(date, granularity);
    let entry = series.entry(key).or_insert(BucketValue {
        label,
        value: Some(0.0),
    });
    let current = entry.value.unwrap_or(0.0);
    entry.value = Some(current + delta);
}

fn bucket_key_and_label(
    date: NaiveDate,
    granularity: AdvancedAnalyticsGranularity,
) -> (String, String) {
    match granularity {
        AdvancedAnalyticsGranularity::Day => {
            let key = date.format("%Y-%m-%d").to_string();
            (key.clone(), key)
        }
        AdvancedAnalyticsGranularity::Week => {
            let week_start = week_start_monday(date);
            let key = week_start.format("%Y-%m-%d").to_string();
            (
                key.clone(),
                format!("Week of {}", week_start.format("%Y-%m-%d")),
            )
        }
        AdvancedAnalyticsGranularity::Month => {
            let month_start = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date);
            let key = month_start.format("%Y-%m-%d").to_string();
            (key.clone(), month_start.format("%Y-%m").to_string())
        }
    }
}

fn bucket_label_from_key(key: &str, granularity: AdvancedAnalyticsGranularity) -> String {
    match granularity {
        AdvancedAnalyticsGranularity::Day => key.to_string(),
        AdvancedAnalyticsGranularity::Week => format!("Week of {key}"),
        AdvancedAnalyticsGranularity::Month => key.get(0..7).unwrap_or(key).to_string(),
    }
}

fn week_start_monday(date: NaiveDate) -> NaiveDate {
    let offset = i64::from(date.weekday().num_days_from_monday());
    date - Duration::days(offset)
}

fn parse_activity_day(value: &str) -> Option<NaiveDate> {
    let trimmed = value.trim();
    if let Some(prefix) = trimmed.get(0..10) {
        NaiveDate::parse_from_str(prefix, "%Y-%m-%d").ok()
    } else {
        None
    }
}

fn fill_metric_series_gaps(metric: &mut InternalMetricResult, range: SeriesFillRange) {
    fill_series_gaps(
        &mut metric.day,
        AdvancedAnalyticsGranularity::Day,
        range.start,
        range.end,
    );
    fill_series_gaps(
        &mut metric.week,
        AdvancedAnalyticsGranularity::Week,
        range.start,
        range.end,
    );
    fill_series_gaps(
        &mut metric.month,
        AdvancedAnalyticsGranularity::Month,
        range.start,
        range.end,
    );
}

fn fill_series_gaps(
    series: &mut BucketSeries,
    granularity: AdvancedAnalyticsGranularity,
    start: NaiveDate,
    end: NaiveDate,
) {
    let mut cursor = bucket_start_for_granularity(start, granularity);
    let end_bucket = bucket_start_for_granularity(end, granularity);

    while cursor <= end_bucket {
        let (key, label) = bucket_key_and_label(cursor, granularity);
        series.entry(key).or_insert(BucketValue {
            label,
            value: Some(0.0),
        });
        cursor = next_bucket_start(cursor, granularity);
    }
}

fn bucket_start_for_granularity(
    date: NaiveDate,
    granularity: AdvancedAnalyticsGranularity,
) -> NaiveDate {
    match granularity {
        AdvancedAnalyticsGranularity::Day => date,
        AdvancedAnalyticsGranularity::Week => week_start_monday(date),
        AdvancedAnalyticsGranularity::Month => {
            NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date)
        }
    }
}

fn next_bucket_start(date: NaiveDate, granularity: AdvancedAnalyticsGranularity) -> NaiveDate {
    match granularity {
        AdvancedAnalyticsGranularity::Day => date + Duration::days(1),
        AdvancedAnalyticsGranularity::Week => date + Duration::days(7),
        AdvancedAnalyticsGranularity::Month => {
            let (year, month) = if date.month() == 12 {
                (date.year() + 1, 1)
            } else {
                (date.year(), date.month() + 1)
            };
            NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(date + Duration::days(31))
        }
    }
}

fn normalized_activity_condition_groups(
    base: &AdvancedAnalyticsBaseMetricDefinition,
) -> Vec<Vec<AdvancedAnalyticsActivityCondition>> {
    let grouped: Vec<Vec<AdvancedAnalyticsActivityCondition>> = base
        .activity_condition_groups
        .iter()
        .map(|group| group.conditions.clone())
        .filter(|conditions| !conditions.is_empty())
        .collect();
    if !grouped.is_empty() {
        return grouped;
    }

    if base.activity_conditions.is_empty() {
        return Vec::new();
    }

    match base.activity_condition_join {
        AdvancedAnalyticsConditionJoin::And => vec![base.activity_conditions.clone()],
        AdvancedAnalyticsConditionJoin::Or => base
            .activity_conditions
            .iter()
            .cloned()
            .map(|condition| vec![condition])
            .collect(),
    }
}

fn normalized_sample_condition_groups(
    base: &AdvancedAnalyticsBaseMetricDefinition,
) -> Vec<Vec<AdvancedAnalyticsSampleCondition>> {
    let grouped: Vec<Vec<AdvancedAnalyticsSampleCondition>> = base
        .sample_condition_groups
        .iter()
        .map(|group| group.conditions.clone())
        .filter(|conditions| !conditions.is_empty())
        .collect();
    if !grouped.is_empty() {
        return grouped;
    }

    if base.sample_conditions.is_empty() {
        return Vec::new();
    }

    match base.sample_condition_join {
        AdvancedAnalyticsConditionJoin::And => vec![base.sample_conditions.clone()],
        AdvancedAnalyticsConditionJoin::Or => base
            .sample_conditions
            .iter()
            .cloned()
            .map(|condition| vec![condition])
            .collect(),
    }
}

fn activity_matches_condition_groups(
    activity: &ActivitySummary,
    condition_groups: &[Vec<AdvancedAnalyticsActivityCondition>],
) -> bool {
    if condition_groups.is_empty() {
        return true;
    }

    condition_groups.iter().any(|conditions| {
        conditions
            .iter()
            .all(|condition| activity_matches_condition(activity, condition))
    })
}

fn activity_matches_condition(
    activity: &ActivitySummary,
    condition: &AdvancedAnalyticsActivityCondition,
) -> bool {
    match condition.field {
        AdvancedAnalyticsActivityConditionField::Title => {
            text_condition_matches(&activity.title, condition.operator, condition)
        }
        AdvancedAnalyticsActivityConditionField::Category => {
            text_condition_matches(&activity.category, condition.operator, condition)
        }
        AdvancedAnalyticsActivityConditionField::SportType => {
            text_condition_matches(&activity.sport_type, condition.operator, condition)
        }
        AdvancedAnalyticsActivityConditionField::Weekday => {
            let Some(date) = parse_activity_day(&activity.activity_start) else {
                return false;
            };
            let actual = weekday_name(date.weekday().num_days_from_monday() as usize);
            text_condition_matches(actual, condition.operator, condition)
        }
        AdvancedAnalyticsActivityConditionField::DistanceM => numeric_condition_matches(
            Some(activity.distance_m),
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsActivityConditionField::DurationSeconds => numeric_condition_matches(
            Some(activity.duration_seconds),
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsActivityConditionField::MovingDurationSeconds => {
            numeric_condition_matches(
                Some(activity.moving_duration_seconds),
                condition.operator,
                condition.number_value,
            )
        }
        AdvancedAnalyticsActivityConditionField::ElevationGainM => numeric_condition_matches(
            Some(activity.elevation_gain_m),
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsActivityConditionField::AvgHr => {
            numeric_condition_matches(activity.avg_hr, condition.operator, condition.number_value)
        }
        AdvancedAnalyticsActivityConditionField::MaxHr => {
            numeric_condition_matches(activity.max_hr, condition.operator, condition.number_value)
        }
        AdvancedAnalyticsActivityConditionField::HasGps => bool_condition_matches(
            activity.has_gps,
            condition.operator,
            condition.bool_value,
            condition.value.as_deref(),
        ),
    }
}

fn weekday_name(index_from_monday: usize) -> &'static str {
    match index_from_monday {
        0 => "monday",
        1 => "tuesday",
        2 => "wednesday",
        3 => "thursday",
        4 => "friday",
        5 => "saturday",
        _ => "sunday",
    }
}

fn normalized_tokens_from_condition(condition: &AdvancedAnalyticsActivityCondition) -> Vec<String> {
    if let Some(values) = &condition.values {
        return values
            .iter()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .collect();
    }

    condition
        .value
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .map(|part| part.trim().to_lowercase())
        .filter(|part| !part.is_empty())
        .collect()
}

fn text_condition_matches(
    text: &str,
    operator: AdvancedAnalyticsActivityConditionOperator,
    condition: &AdvancedAnalyticsActivityCondition,
) -> bool {
    let haystack = text.trim().to_lowercase();
    let needle = condition
        .value
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    match operator {
        AdvancedAnalyticsActivityConditionOperator::Contains => haystack.contains(&needle),
        AdvancedAnalyticsActivityConditionOperator::Equals
        | AdvancedAnalyticsActivityConditionOperator::Is => haystack == needle,
        AdvancedAnalyticsActivityConditionOperator::StartsWith => haystack.starts_with(&needle),
        AdvancedAnalyticsActivityConditionOperator::ContainsAny => {
            let tokens = normalized_tokens_from_condition(condition);
            !tokens.is_empty() && tokens.iter().any(|token| haystack.contains(token))
        }
        AdvancedAnalyticsActivityConditionOperator::ContainsAll => {
            let tokens = normalized_tokens_from_condition(condition);
            !tokens.is_empty() && tokens.iter().all(|token| haystack.contains(token))
        }
        AdvancedAnalyticsActivityConditionOperator::IsNot
        | AdvancedAnalyticsActivityConditionOperator::NotEquals => haystack != needle,
        _ => false,
    }
}

fn numeric_condition_matches(
    actual: Option<f64>,
    operator: AdvancedAnalyticsActivityConditionOperator,
    expected: Option<f64>,
) -> bool {
    let (Some(actual), Some(expected)) = (actual, expected) else {
        return false;
    };
    match operator {
        AdvancedAnalyticsActivityConditionOperator::GreaterThan => actual > expected,
        AdvancedAnalyticsActivityConditionOperator::GreaterThanOrEqual => actual >= expected,
        AdvancedAnalyticsActivityConditionOperator::LessThan => actual < expected,
        AdvancedAnalyticsActivityConditionOperator::LessThanOrEqual => actual <= expected,
        AdvancedAnalyticsActivityConditionOperator::NumberEquals
        | AdvancedAnalyticsActivityConditionOperator::Equals
        | AdvancedAnalyticsActivityConditionOperator::Is => (actual - expected).abs() < 1e-9,
        AdvancedAnalyticsActivityConditionOperator::NotEquals
        | AdvancedAnalyticsActivityConditionOperator::IsNot => (actual - expected).abs() >= 1e-9,
        _ => false,
    }
}

fn bool_condition_matches(
    actual: bool,
    operator: AdvancedAnalyticsActivityConditionOperator,
    expected_bool: Option<bool>,
    expected_text: Option<&str>,
) -> bool {
    let expected = expected_bool.or_else(|| {
        expected_text.and_then(|value| match value.trim().to_lowercase().as_str() {
            "true" | "yes" | "1" => Some(true),
            "false" | "no" | "0" => Some(false),
            _ => None,
        })
    });
    let Some(expected) = expected else {
        return false;
    };

    match operator {
        AdvancedAnalyticsActivityConditionOperator::Is
        | AdvancedAnalyticsActivityConditionOperator::Equals => actual == expected,
        AdvancedAnalyticsActivityConditionOperator::IsNot
        | AdvancedAnalyticsActivityConditionOperator::NotEquals => actual != expected,
        _ => false,
    }
}

fn compute_matching_sample_time(
    samples: &[ActivitySample],
    condition_groups: &[Vec<AdvancedAnalyticsSampleCondition>],
    hr_zone_upper_bounds: &[u16],
    minimum_continuous_match_seconds: f64,
) -> SampleTimeComputation {
    if samples.len() < 2 {
        return SampleTimeComputation {
            included_seconds: 0.0,
            filtered_out_seconds: 0.0,
            total_tracked_seconds: 0.0,
            segments: Vec::new(),
        };
    }

    let mut included_seconds = 0.0;
    let mut filtered_out_seconds = 0.0;
    let mut total_tracked_seconds = 0.0;
    let mut current_run_seconds = 0.0;
    let mut current_run_start_elapsed: Option<f64> = None;
    let mut current_run_end_elapsed: Option<f64> = None;
    let mut segments = Vec::new();
    let mut previous: Option<&ActivitySample> = None;

    let flush_current_run =
        |current_run_start_elapsed: &mut Option<f64>,
         current_run_end_elapsed: &mut Option<f64>,
         current_run_seconds: &mut f64,
         included_seconds: &mut f64,
         filtered_out_seconds: &mut f64,
         segments: &mut Vec<AdvancedAnalyticsSampleTimeSegment>| {
            if *current_run_seconds <= 0.0 {
                *current_run_start_elapsed = None;
                *current_run_end_elapsed = None;
                *current_run_seconds = 0.0;
                return;
            }

            let start = current_run_start_elapsed.unwrap_or(0.0);
            let end = current_run_end_elapsed.unwrap_or(start + *current_run_seconds);
            let duration = (end - start).max(0.0);
            if duration <= 0.0 {
                *current_run_start_elapsed = None;
                *current_run_end_elapsed = None;
                *current_run_seconds = 0.0;
                return;
            }

            if *current_run_seconds >= minimum_continuous_match_seconds {
                *included_seconds += *current_run_seconds;
                segments.push(AdvancedAnalyticsSampleTimeSegment {
                    start_elapsed_seconds: start,
                    end_elapsed_seconds: end,
                    duration_seconds: duration,
                    status: AdvancedAnalyticsSampleTimeSegmentStatus::Included,
                });
            } else {
                *filtered_out_seconds += *current_run_seconds;
                segments.push(AdvancedAnalyticsSampleTimeSegment {
                    start_elapsed_seconds: start,
                    end_elapsed_seconds: end,
                    duration_seconds: duration,
                    status: AdvancedAnalyticsSampleTimeSegmentStatus::FilteredOut,
                });
            }

            *current_run_start_elapsed = None;
            *current_run_end_elapsed = None;
            *current_run_seconds = 0.0;
        };

    for current in samples {
        if let Some(prev) = previous {
            let start_elapsed = prev.elapsed_seconds;
            let end_elapsed = current.elapsed_seconds;
            let has_valid_interval =
                end_elapsed.is_finite() && start_elapsed.is_finite() && end_elapsed > start_elapsed;

            if has_valid_interval {
                let delta = end_elapsed - start_elapsed;
                if delta.is_finite() && delta > 0.0 {
                    total_tracked_seconds += delta;
                    let matches = if condition_groups.is_empty() {
                        true
                    } else {
                        condition_groups.iter().any(|conditions| {
                            conditions.iter().all(|condition| {
                                sample_matches_condition(prev, condition, hr_zone_upper_bounds)
                            })
                        })
                    };
                    if matches {
                        if current_run_start_elapsed.is_none() {
                            current_run_start_elapsed = Some(start_elapsed);
                        }
                        current_run_end_elapsed = Some(end_elapsed);
                        current_run_seconds += delta;
                    } else {
                        flush_current_run(
                            &mut current_run_start_elapsed,
                            &mut current_run_end_elapsed,
                            &mut current_run_seconds,
                            &mut included_seconds,
                            &mut filtered_out_seconds,
                            &mut segments,
                        );
                    }
                } else {
                    flush_current_run(
                        &mut current_run_start_elapsed,
                        &mut current_run_end_elapsed,
                        &mut current_run_seconds,
                        &mut included_seconds,
                        &mut filtered_out_seconds,
                        &mut segments,
                    );
                }
            } else {
                flush_current_run(
                    &mut current_run_start_elapsed,
                    &mut current_run_end_elapsed,
                    &mut current_run_seconds,
                    &mut included_seconds,
                    &mut filtered_out_seconds,
                    &mut segments,
                );
            }
        }
        previous = Some(current);
    }

    flush_current_run(
        &mut current_run_start_elapsed,
        &mut current_run_end_elapsed,
        &mut current_run_seconds,
        &mut included_seconds,
        &mut filtered_out_seconds,
        &mut segments,
    );

    SampleTimeComputation {
        included_seconds,
        filtered_out_seconds,
        total_tracked_seconds,
        segments,
    }
}

fn sample_matches_condition(
    sample: &ActivitySample,
    condition: &AdvancedAnalyticsSampleCondition,
    hr_zone_upper_bounds: &[u16],
) -> bool {
    match condition.field {
        AdvancedAnalyticsSampleConditionField::HeartRate => sample_numeric_condition_matches(
            sample.heart_rate,
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsSampleConditionField::PowerWatts => sample_numeric_condition_matches(
            sample.power_watts,
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsSampleConditionField::Cadence => sample_numeric_condition_matches(
            sample.cadence,
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsSampleConditionField::SpeedMps => sample_numeric_condition_matches(
            sample.speed_mps,
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsSampleConditionField::PaceMinPerKm => sample_numeric_condition_matches(
            sample_pace_min_per_km(sample.speed_mps),
            condition.operator,
            condition.number_value,
        ),
        AdvancedAnalyticsSampleConditionField::HeartRateZone => {
            if condition.operator != AdvancedAnalyticsSampleConditionOperator::Is {
                return false;
            }
            let Some(zone) = condition.zone else {
                return false;
            };
            let Some(hr) = sample.heart_rate else {
                return false;
            };
            let zone_index = heart_rate_zone_index(hr, hr_zone_upper_bounds) + 1;
            zone_index == zone
        }
    }
}

fn sample_numeric_condition_matches(
    actual: Option<f64>,
    operator: AdvancedAnalyticsSampleConditionOperator,
    expected: Option<f64>,
) -> bool {
    let (Some(actual), Some(expected)) = (actual, expected) else {
        return false;
    };
    match operator {
        AdvancedAnalyticsSampleConditionOperator::GreaterThan => actual > expected,
        AdvancedAnalyticsSampleConditionOperator::GreaterThanOrEqual => actual >= expected,
        AdvancedAnalyticsSampleConditionOperator::LessThan => actual < expected,
        AdvancedAnalyticsSampleConditionOperator::LessThanOrEqual => actual <= expected,
        AdvancedAnalyticsSampleConditionOperator::NumberEquals
        | AdvancedAnalyticsSampleConditionOperator::Is => (actual - expected).abs() < 1e-9,
        AdvancedAnalyticsSampleConditionOperator::NotEquals => (actual - expected).abs() >= 1e-9,
    }
}

fn sample_pace_min_per_km(speed_mps: Option<f64>) -> Option<f64> {
    let speed_mps = speed_mps?;
    if speed_mps <= 0.0 {
        return None;
    }
    Some(1000.0 / speed_mps / 60.0)
}

fn heart_rate_zone_index(hr: f64, upper_bounds: &[u16]) -> u8 {
    for (index, upper) in upper_bounds.iter().enumerate() {
        if hr <= f64::from(*upper) {
            return index as u8;
        }
    }
    upper_bounds.len() as u8
}

fn build_streak_results(
    streak_defs: &[AdvancedAnalyticsStreakDefinition],
    metric_cache: &HashMap<String, InternalMetricResult>,
) -> HashMap<String, AdvancedAnalyticsStreakResult> {
    let mut results = HashMap::new();
    for streak in streak_defs {
        let mut errors = Vec::new();
        let warnings = Vec::new();

        let required_metric_ids = streak_metric_ids(streak);
        let Some(primary_metric) = metric_cache.get(&streak.metric_id) else {
            results.insert(
                streak.id.clone(),
                AdvancedAnalyticsStreakResult {
                    streak_id: streak.id.clone(),
                    name: streak.name.clone(),
                    count: 0,
                    longest: 0,
                    status: AdvancedAnalyticsStreakStatus::Broken,
                    current_period_key: current_period_key(streak.period),
                    current_period_value: 0.0,
                    required_metric_values: HashMap::new(),
                    errors: vec![format!("Metric '{}' not found.", streak.metric_id)],
                    warnings,
                },
            );
            continue;
        };
        let mut missing_metric_ids = Vec::new();
        let mut required_metrics = Vec::new();
        for metric_id in required_metric_ids {
            if let Some(metric) = metric_cache.get(metric_id) {
                required_metrics.push((metric_id, metric));
            } else {
                missing_metric_ids.push(metric_id.to_string());
            }
        }
        if !missing_metric_ids.is_empty() {
            results.insert(
                streak.id.clone(),
                AdvancedAnalyticsStreakResult {
                    streak_id: streak.id.clone(),
                    name: streak.name.clone(),
                    count: 0,
                    longest: 0,
                    status: AdvancedAnalyticsStreakStatus::Broken,
                    current_period_key: current_period_key(streak.period),
                    current_period_value: 0.0,
                    required_metric_values: HashMap::new(),
                    errors: missing_metric_ids
                        .iter()
                        .map(|metric_id| format!("Metric '{}' not found.", metric_id))
                        .collect(),
                    warnings,
                },
            );
            continue;
        }

        let primary_series = match streak.period {
            AdvancedAnalyticsPeriod::Day => &primary_metric.day,
            AdvancedAnalyticsPeriod::Week => &primary_metric.week,
        };
        let required_series: Vec<&BucketSeries> = required_metrics
            .iter()
            .map(|(_, metric)| match streak.period {
                AdvancedAnalyticsPeriod::Day => &metric.day,
                AdvancedAnalyticsPeriod::Week => &metric.week,
            })
            .collect();
        let current_key = current_period_key(streak.period);
        let previous_key = previous_period_key(&current_key, streak.period);

        let current_value = primary_series
            .get(&current_key)
            .and_then(|point| point.value)
            .unwrap_or(0.0);
        let required_metric_values: HashMap<String, f64> = required_metrics
            .iter()
            .map(|(metric_id, metric)| {
                let series = match streak.period {
                    AdvancedAnalyticsPeriod::Day => &metric.day,
                    AdvancedAnalyticsPeriod::Week => &metric.week,
                };
                let value = series
                    .get(&current_key)
                    .and_then(|point| point.value)
                    .unwrap_or(0.0);
                ((*metric_id).to_string(), value)
            })
            .collect();
        let previous_meets = previous_key
            .as_deref()
            .is_some_and(|key| period_matches_all_required_metrics(&required_series, key, streak));
        let current_meets =
            period_matches_all_required_metrics(&required_series, &current_key, streak);

        let (count, status) = if current_meets {
            (
                consecutive_count_from(&required_series, &current_key, streak),
                AdvancedAnalyticsStreakStatus::Active,
            )
        } else if previous_meets {
            let count = previous_key
                .as_deref()
                .map(|key| consecutive_count_from(&required_series, key, streak))
                .unwrap_or(0);
            (count, AdvancedAnalyticsStreakStatus::Pending)
        } else {
            (0, AdvancedAnalyticsStreakStatus::Broken)
        };
        let longest = longest_consecutive_count(primary_series, &required_series, streak);

        if required_metrics
            .iter()
            .any(|(_, metric)| !metric.errors.is_empty())
        {
            errors.push(format!(
                "One or more required metrics have errors and may produce incomplete streak values."
            ));
        }

        results.insert(
            streak.id.clone(),
            AdvancedAnalyticsStreakResult {
                streak_id: streak.id.clone(),
                name: streak.name.clone(),
                count,
                longest,
                status,
                current_period_key: current_key,
                current_period_value: current_value,
                required_metric_values,
                errors,
                warnings,
            },
        );
    }
    results
}

fn streak_metric_ids(streak: &AdvancedAnalyticsStreakDefinition) -> Vec<&str> {
    let mut metric_ids = vec![streak.metric_id.as_str()];
    for metric_id in &streak.additional_metric_ids {
        let trimmed = metric_id.trim();
        if trimmed.is_empty() || trimmed == streak.metric_id {
            continue;
        }
        if metric_ids.iter().any(|existing| existing == &trimmed) {
            continue;
        }
        metric_ids.push(trimmed);
    }
    metric_ids
}

fn period_matches_metric(
    series: &BucketSeries,
    key: &str,
    streak: &AdvancedAnalyticsStreakDefinition,
) -> bool {
    series
        .get(key)
        .and_then(|point| point.value)
        .is_some_and(|value| {
            threshold_matches(streak.threshold_operator, value, streak.threshold_value)
        })
}

fn period_matches_all_required_metrics(
    required_series: &[&BucketSeries],
    key: &str,
    streak: &AdvancedAnalyticsStreakDefinition,
) -> bool {
    required_series
        .iter()
        .all(|series| period_matches_metric(series, key, streak))
}

fn consecutive_count_from(
    required_series: &[&BucketSeries],
    start_key: &str,
    streak: &AdvancedAnalyticsStreakDefinition,
) -> usize {
    let mut count = 0;
    let mut cursor = Some(start_key.to_string());
    while let Some(key) = cursor {
        let meets = period_matches_all_required_metrics(required_series, &key, streak);
        if !meets {
            break;
        }
        count += 1;
        cursor = previous_period_key(&key, streak.period);
    }
    count
}

fn longest_consecutive_count(
    reference_series: &BucketSeries,
    required_series: &[&BucketSeries],
    streak: &AdvancedAnalyticsStreakDefinition,
) -> usize {
    let mut longest = 0usize;
    let mut current = 0usize;

    for key in reference_series.keys() {
        let meets = period_matches_all_required_metrics(required_series, key, streak);
        if meets {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 0;
        }
    }

    longest
}

fn threshold_matches(
    operator: AdvancedAnalyticsThresholdOperator,
    actual: f64,
    threshold: f64,
) -> bool {
    match operator {
        AdvancedAnalyticsThresholdOperator::GreaterThan => actual > threshold,
        AdvancedAnalyticsThresholdOperator::GreaterThanOrEqual => actual >= threshold,
        AdvancedAnalyticsThresholdOperator::LessThan => actual < threshold,
        AdvancedAnalyticsThresholdOperator::LessThanOrEqual => actual <= threshold,
        AdvancedAnalyticsThresholdOperator::Equals => (actual - threshold).abs() < 1e-9,
    }
}

fn current_period_key(period: AdvancedAnalyticsPeriod) -> String {
    let today = Local::now().date_naive();
    match period {
        AdvancedAnalyticsPeriod::Day => today.format("%Y-%m-%d").to_string(),
        AdvancedAnalyticsPeriod::Week => week_start_monday(today).format("%Y-%m-%d").to_string(),
    }
}

fn previous_period_key(current_key: &str, period: AdvancedAnalyticsPeriod) -> Option<String> {
    let date = NaiveDate::parse_from_str(current_key, "%Y-%m-%d").ok()?;
    let prev = match period {
        AdvancedAnalyticsPeriod::Day => date - Duration::days(1),
        AdvancedAnalyticsPeriod::Week => date - Duration::days(7),
    };
    Some(prev.format("%Y-%m-%d").to_string())
}

fn build_chart_results(
    charts: &[AdvancedAnalyticsChartDefinition],
    metric_cache: &HashMap<String, InternalMetricResult>,
) -> HashMap<String, AdvancedAnalyticsChartResult> {
    let mut output = HashMap::new();

    for chart in charts {
        let mut result = AdvancedAnalyticsChartResult {
            chart_id: chart.id.clone(),
            name: chart.name.clone(),
            chart_type: chart.chart_type,
            granularity: chart.granularity,
            metric_ids: chart.metric_ids.clone(),
            points: Vec::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        };

        match chart.chart_type {
            AdvancedAnalyticsChartType::Bar | AdvancedAnalyticsChartType::Line => {
                if chart.metric_ids.len() != 1 {
                    result
                        .errors
                        .push("Bar/Line charts require exactly 1 metric.".to_string());
                }
            }
            AdvancedAnalyticsChartType::StackedBar => {
                if !(2..=5).contains(&chart.metric_ids.len()) {
                    result
                        .errors
                        .push("Stacked bar charts require 2 to 5 metrics.".to_string());
                }
            }
        }

        let mut union_keys: BTreeMap<String, String> = BTreeMap::new();
        let mut metric_series_maps: HashMap<String, &BucketSeries> = HashMap::new();

        for metric_id in &chart.metric_ids {
            let Some(metric) = metric_cache.get(metric_id) else {
                result
                    .errors
                    .push(format!("Metric '{}' not found.", metric_id));
                continue;
            };
            let series = match chart.granularity {
                AdvancedAnalyticsGranularity::Day => &metric.day,
                AdvancedAnalyticsGranularity::Week => &metric.week,
                AdvancedAnalyticsGranularity::Month => &metric.month,
            };
            for (key, value) in series {
                union_keys
                    .entry(key.clone())
                    .or_insert_with(|| value.label.clone());
            }
            metric_series_maps.insert(metric_id.clone(), series);
        }

        if result.errors.is_empty() {
            for (key, label) in union_keys {
                let mut values = HashMap::new();
                for metric_id in &chart.metric_ids {
                    let value = metric_series_maps
                        .get(metric_id)
                        .and_then(|series| series.get(&key))
                        .and_then(|point| point.value);
                    values.insert(metric_id.clone(), value);
                }
                result
                    .points
                    .push(AdvancedAnalyticsChartBucketPoint { key, label, values });
            }
        }

        output.insert(chart.id.clone(), result);
    }

    output
}

fn finalize_metric(internal: InternalMetricResult) -> AdvancedAnalyticsMetricResult {
    AdvancedAnalyticsMetricResult {
        metric_id: internal.metric_id,
        name: internal.name,
        scalar_value: internal.scalar_value,
        unit: internal.unit,
        series_by_granularity: AdvancedAnalyticsSeriesByGranularity {
            day: series_to_points(internal.day),
            week: series_to_points(internal.week),
            month: series_to_points(internal.month),
        },
        sample_time_preview: internal.sample_time_preview,
        errors: internal.errors,
        warnings: internal.warnings,
    }
}

fn series_to_points(series: BucketSeries) -> Vec<AdvancedAnalyticsBucketPoint> {
    series
        .into_iter()
        .map(|(key, bucket)| AdvancedAnalyticsBucketPoint {
            key,
            label: bucket.label,
            value: bucket.value,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        AdvancedAnalyticsActivityCondition, AdvancedAnalyticsActivityConditionField,
        AdvancedAnalyticsActivityConditionOperator, AdvancedAnalyticsBaseMeasure,
        AdvancedAnalyticsBaseMetricDefinition, AdvancedAnalyticsConditionJoin,
        AdvancedAnalyticsFormulaOperator, AdvancedAnalyticsSampleCondition,
        AdvancedAnalyticsSampleConditionField, AdvancedAnalyticsSampleConditionOperator,
        AdvancedAnalyticsThresholdOperator,
    };

    #[test]
    fn title_matching_is_case_insensitive_and_supports_any_all() {
        let contains = AdvancedAnalyticsActivityCondition {
            id: "1".into(),
            field: AdvancedAnalyticsActivityConditionField::Title,
            operator: AdvancedAnalyticsActivityConditionOperator::Contains,
            value: Some("push".into()),
            values: None,
            number_value: None,
            bool_value: None,
        };
        assert!(text_condition_matches(
            "Upper PUSH Session",
            contains.operator,
            &contains
        ));

        let any = AdvancedAnalyticsActivityCondition {
            operator: AdvancedAnalyticsActivityConditionOperator::ContainsAny,
            value: Some("push, pull".into()),
            ..contains.clone()
        };
        assert!(text_condition_matches("Leg + Pull Day", any.operator, &any));

        let all = AdvancedAnalyticsActivityCondition {
            operator: AdvancedAnalyticsActivityConditionOperator::ContainsAll,
            value: Some("push, day".into()),
            ..contains
        };
        assert!(text_condition_matches("Push day", all.operator, &all));
    }

    #[test]
    fn sample_time_uses_previous_sample_interval_semantics() {
        let samples = vec![
            ActivitySample {
                elapsed_seconds: 0.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(130.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 10.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(131.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 20.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(151.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
        ];

        let conditions = vec![AdvancedAnalyticsSampleCondition {
            id: "z2".into(),
            field: AdvancedAnalyticsSampleConditionField::HeartRateZone,
            operator: AdvancedAnalyticsSampleConditionOperator::Is,
            number_value: None,
            zone: Some(2),
        }];

        let condition_groups = vec![conditions];
        let seconds =
            compute_matching_sample_time(&samples, &condition_groups, &[120, 140, 160, 180], 0.0);
        assert_eq!(seconds.included_seconds, 20.0);
        assert_eq!(seconds.filtered_out_seconds, 0.0);
    }

    #[test]
    fn sample_time_minimum_continuous_duration_ignores_short_spikes() {
        let samples = vec![
            ActivitySample {
                elapsed_seconds: 0.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(130.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 10.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(132.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 20.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(150.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 30.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(151.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 40.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(133.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 50.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(134.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 60.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(135.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 70.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(136.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 80.0,
                distance_m: None,
                speed_mps: None,
                heart_rate: Some(152.0),
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
        ];

        let condition_groups = vec![vec![AdvancedAnalyticsSampleCondition {
            id: "z2".into(),
            field: AdvancedAnalyticsSampleConditionField::HeartRateZone,
            operator: AdvancedAnalyticsSampleConditionOperator::Is,
            number_value: None,
            zone: Some(2),
        }]];

        let seconds =
            compute_matching_sample_time(&samples, &condition_groups, &[120, 140, 160, 180], 21.0);

        assert_eq!(seconds.included_seconds, 40.0);
        assert_eq!(seconds.filtered_out_seconds, 20.0);
    }

    #[test]
    fn activity_conditions_support_or_join() {
        let activity = ActivitySummary {
            id: 1,
            source_path: "a.fit".into(),
            activity_start: "2026-02-01T08:00:00Z".into(),
            title: "Easy Run".into(),
            category: "Running".into(),
            sport_type: "running".into(),
            duration_seconds: 1800.0,
            moving_duration_seconds: 1700.0,
            distance_m: 5000.0,
            elevation_gain_m: 50.0,
            avg_speed_mps: Some(2.9),
            max_speed_mps: Some(4.2),
            avg_hr: Some(142.0),
            min_hr: Some(110.0),
            max_hr: Some(165.0),
            has_gps: true,
        };

        let conditions = vec![
            AdvancedAnalyticsActivityCondition {
                id: "distance".into(),
                field: AdvancedAnalyticsActivityConditionField::DistanceM,
                operator: AdvancedAnalyticsActivityConditionOperator::GreaterThan,
                value: None,
                values: None,
                number_value: Some(10000.0),
                bool_value: None,
            },
            AdvancedAnalyticsActivityCondition {
                id: "title".into(),
                field: AdvancedAnalyticsActivityConditionField::Title,
                operator: AdvancedAnalyticsActivityConditionOperator::Contains,
                value: Some("run".into()),
                values: None,
                number_value: None,
                bool_value: None,
            },
        ];

        let and_groups = vec![conditions.clone()];
        let or_groups = conditions
            .iter()
            .cloned()
            .map(|condition| vec![condition])
            .collect::<Vec<_>>();

        assert!(!activity_matches_condition_groups(&activity, &and_groups));
        assert!(activity_matches_condition_groups(&activity, &or_groups));
    }

    #[test]
    fn sample_time_conditions_support_or_join() {
        let samples = vec![
            ActivitySample {
                elapsed_seconds: 0.0,
                distance_m: None,
                speed_mps: Some(3.2),
                heart_rate: Some(130.0),
                cadence: Some(80.0),
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 10.0,
                distance_m: None,
                speed_mps: Some(2.5),
                heart_rate: Some(155.0),
                cadence: Some(70.0),
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 20.0,
                distance_m: None,
                speed_mps: Some(3.1),
                heart_rate: Some(145.0),
                cadence: Some(85.0),
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
        ];

        let conditions = vec![
            AdvancedAnalyticsSampleCondition {
                id: "hr".into(),
                field: AdvancedAnalyticsSampleConditionField::HeartRate,
                operator: AdvancedAnalyticsSampleConditionOperator::GreaterThan,
                number_value: Some(150.0),
                zone: None,
            },
            AdvancedAnalyticsSampleCondition {
                id: "speed".into(),
                field: AdvancedAnalyticsSampleConditionField::SpeedMps,
                operator: AdvancedAnalyticsSampleConditionOperator::GreaterThan,
                number_value: Some(3.0),
                zone: None,
            },
        ];

        let and_groups = vec![conditions.clone()];
        let or_groups = conditions
            .iter()
            .cloned()
            .map(|condition| vec![condition])
            .collect::<Vec<_>>();

        let and_seconds =
            compute_matching_sample_time(&samples, &and_groups, &[120, 140, 160, 180], 0.0);
        let or_seconds =
            compute_matching_sample_time(&samples, &or_groups, &[120, 140, 160, 180], 0.0);

        assert_eq!(and_seconds.included_seconds, 0.0);
        assert_eq!(or_seconds.included_seconds, 20.0);
    }

    #[test]
    fn sample_time_pace_condition_matches_from_speed_samples() {
        let samples = vec![
            ActivitySample {
                elapsed_seconds: 0.0,
                distance_m: None,
                speed_mps: Some(3.2), // 5.21 min/km
                heart_rate: None,
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
            ActivitySample {
                elapsed_seconds: 10.0,
                distance_m: None,
                speed_mps: Some(4.0), // 4.17 min/km
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
                distance_m: None,
                speed_mps: Some(3.1), // 5.38 min/km
                heart_rate: None,
                cadence: None,
                power_watts: None,
                altitude_m: None,
                lat: None,
                lon: None,
                timestamp: None,
            },
        ];

        let condition_groups = vec![vec![AdvancedAnalyticsSampleCondition {
            id: "pace".into(),
            field: AdvancedAnalyticsSampleConditionField::PaceMinPerKm,
            operator: AdvancedAnalyticsSampleConditionOperator::LessThanOrEqual,
            number_value: Some(5.0),
            zone: None,
        }]];

        let result =
            compute_matching_sample_time(&samples, &condition_groups, &[120, 140, 160, 180], 0.0);

        assert_eq!(result.included_seconds, 10.0);
    }

    #[test]
    fn legacy_or_activity_conditions_are_normalized_to_groups() {
        let base = AdvancedAnalyticsBaseMetricDefinition {
            measure: AdvancedAnalyticsBaseMeasure::ActivitiesCount,
            activity_conditions: vec![
                AdvancedAnalyticsActivityCondition {
                    id: "a".into(),
                    field: AdvancedAnalyticsActivityConditionField::Title,
                    operator: AdvancedAnalyticsActivityConditionOperator::Contains,
                    value: Some("run".into()),
                    values: None,
                    number_value: None,
                    bool_value: None,
                },
                AdvancedAnalyticsActivityCondition {
                    id: "b".into(),
                    field: AdvancedAnalyticsActivityConditionField::Category,
                    operator: AdvancedAnalyticsActivityConditionOperator::Equals,
                    value: Some("running".into()),
                    values: None,
                    number_value: None,
                    bool_value: None,
                },
            ],
            activity_condition_groups: Vec::new(),
            activity_condition_join: AdvancedAnalyticsConditionJoin::Or,
            sample_conditions: Vec::new(),
            sample_condition_groups: Vec::new(),
            sample_condition_join: AdvancedAnalyticsConditionJoin::And,
            minimum_sample_match_seconds: None,
            default_chart_granularity: None,
            display_unit: None,
        };

        let groups = normalized_activity_condition_groups(&base);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].len(), 1);
        assert_eq!(groups[1].len(), 1);
    }

    #[test]
    fn formula_division_by_zero_returns_none() {
        assert_eq!(
            apply_formula(
                AdvancedAnalyticsFormulaOperator::Divide,
                Some(10.0),
                Some(0.0)
            ),
            None
        );
        assert_eq!(
            apply_formula(
                AdvancedAnalyticsFormulaOperator::Percent,
                Some(10.0),
                Some(0.0)
            ),
            None
        );
    }

    #[test]
    fn threshold_comparisons_work() {
        assert!(threshold_matches(
            AdvancedAnalyticsThresholdOperator::GreaterThanOrEqual,
            60.0,
            60.0
        ));
        assert!(!threshold_matches(
            AdvancedAnalyticsThresholdOperator::GreaterThan,
            60.0,
            60.0
        ));
    }

    #[test]
    fn fills_missing_buckets_with_zero_values_across_range() {
        let mut metric = InternalMetricResult {
            metric_id: "m1".into(),
            name: "Metric".into(),
            scalar_value: Some(2.0),
            unit: Some("count".into()),
            value_unit: Some("count".into()),
            day: BTreeMap::new(),
            week: BTreeMap::new(),
            month: BTreeMap::new(),
            sample_time_preview: None,
            errors: Vec::new(),
            warnings: Vec::new(),
        };

        add_bucket_value(
            &mut metric.day,
            NaiveDate::from_ymd_opt(2026, 2, 2).unwrap(),
            AdvancedAnalyticsGranularity::Day,
            1.0,
        );
        add_bucket_value(
            &mut metric.day,
            NaiveDate::from_ymd_opt(2026, 2, 4).unwrap(),
            AdvancedAnalyticsGranularity::Day,
            1.0,
        );

        fill_metric_series_gaps(
            &mut metric,
            SeriesFillRange {
                start: NaiveDate::from_ymd_opt(2026, 2, 1).unwrap(),
                end: NaiveDate::from_ymd_opt(2026, 2, 5).unwrap(),
            },
        );

        let day_points = series_to_points(metric.day.clone());
        assert_eq!(day_points.len(), 5);
        assert_eq!(day_points[0].key, "2026-02-01");
        assert_eq!(day_points[0].value, Some(0.0));
        assert_eq!(day_points[1].key, "2026-02-02");
        assert_eq!(day_points[1].value, Some(1.0));
        assert_eq!(day_points[2].key, "2026-02-03");
        assert_eq!(day_points[2].value, Some(0.0));
        assert_eq!(day_points[3].key, "2026-02-04");
        assert_eq!(day_points[3].value, Some(1.0));
        assert_eq!(day_points[4].key, "2026-02-05");
        assert_eq!(day_points[4].value, Some(0.0));

        assert_eq!(metric.week.len(), 2);
        assert_eq!(metric.month.len(), 1);
    }

    #[test]
    fn conversion_helpers_convert_distance_time_and_speed_units() {
        let km_to_mi = unit_multiplier("km", "mi").expect("km->mi conversion");
        assert!((km_to_mi - 0.621_371).abs() < 1e-6);

        let sec_to_hour = unit_multiplier("s", "h").expect("s->h conversion");
        assert!((sec_to_hour - (1.0 / 3600.0)).abs() < 1e-9);

        let mps_to_kmh = unit_multiplier("m/s", "km/h").expect("m/s->km/h conversion");
        assert!((mps_to_kmh - 3.6).abs() < 1e-9);
    }

    #[test]
    fn display_unit_conversion_updates_scalar_and_series_values() {
        let mut metric = InternalMetricResult {
            metric_id: "distance".into(),
            name: "Distance".into(),
            scalar_value: Some(3000.0),
            unit: Some("km".into()),
            value_unit: Some("m".into()),
            day: BTreeMap::new(),
            week: BTreeMap::new(),
            month: BTreeMap::new(),
            sample_time_preview: None,
            errors: Vec::new(),
            warnings: Vec::new(),
        };
        metric.day.insert(
            "2026-02-01".into(),
            BucketValue {
                label: "2026-02-01".into(),
                value: Some(1500.0),
            },
        );

        apply_display_unit_conversion(&mut metric, Some("km".into()));

        assert_eq!(metric.unit.as_deref(), Some("km"));
        assert_eq!(metric.value_unit.as_deref(), Some("km"));
        assert!((metric.scalar_value.unwrap_or_default() - 3.0).abs() < 1e-9);
        let day_value = metric
            .day
            .get("2026-02-01")
            .and_then(|point| point.value)
            .unwrap_or_default();
        assert!((day_value - 1.5).abs() < 1e-9);
    }

    #[test]
    fn empty_display_unit_is_treated_as_missing_override() {
        assert_eq!(normalized_unit_option(Some("")), None);
        assert_eq!(normalized_unit_option(Some("   ")), None);
        assert_eq!(normalized_unit_option(Some(" km ")).as_deref(), Some("km"));
    }

    #[test]
    fn infer_division_units_for_common_speed_combinations() {
        assert_eq!(
            infer_division_value_unit(Some("m"), Some("s")).as_deref(),
            Some("m/s")
        );
        assert_eq!(
            infer_division_value_unit(Some("km"), Some("h")).as_deref(),
            Some("km/h")
        );
        assert_eq!(
            infer_division_value_unit(Some("mi"), Some("h")).as_deref(),
            Some("mi/h")
        );
        assert_eq!(infer_division_value_unit(Some("count"), Some("s")), None);
    }
}
