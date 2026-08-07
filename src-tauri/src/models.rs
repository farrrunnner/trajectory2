use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub import_folder_path: Option<String>,
    pub scan_recursive: bool,
    pub last_scan_timestamp: Option<String>,
    pub dark_mode: bool,
    pub accent_theme: String,
    pub heatmap_full_opacity: bool,
    pub chart_max_samples: usize,
    pub chart_outlier_removal: bool,
    pub heart_rate_zone_upper_bounds_bpm: Vec<u16>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            import_folder_path: None,
            scan_recursive: true,
            last_scan_timestamp: None,
            dark_mode: false,
            accent_theme: "citrus-orange".to_string(),
            heatmap_full_opacity: false,
            chart_max_samples: 2000,
            chart_outlier_removal: true,
            heart_rate_zone_upper_bounds_bpm: vec![120, 140, 160, 180],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilters {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub category: Option<String>,
    pub sport_type: Option<String>,
    pub min_distance: Option<f64>,
    pub max_distance: Option<f64>,
    pub day: Option<String>,
}

impl Default for ActivityFilters {
    fn default() -> Self {
        Self {
            start_date: None,
            end_date: None,
            category: None,
            sport_type: None,
            min_distance: None,
            max_distance: None,
            day: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySummary {
    pub id: i64,
    pub source_path: String,
    pub activity_start: String,
    pub title: String,
    pub category: String,
    pub sport_type: String,
    pub duration_seconds: f64,
    pub moving_duration_seconds: f64,
    pub distance_m: f64,
    pub elevation_gain_m: f64,
    pub avg_speed_mps: Option<f64>,
    pub max_speed_mps: Option<f64>,
    pub avg_hr: Option<f64>,
    pub min_hr: Option<f64>,
    pub max_hr: Option<f64>,
    pub has_gps: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPoint {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseSegment {
    pub start_elapsed_seconds: f64,
    pub end_elapsed_seconds: f64,
    pub duration_seconds: f64,
    pub start_timestamp: Option<String>,
    pub end_timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySample {
    pub elapsed_seconds: f64,
    pub distance_m: Option<f64>,
    pub speed_mps: Option<f64>,
    pub heart_rate: Option<f64>,
    pub cadence: Option<f64>,
    pub power_watts: Option<f64>,
    pub altitude_m: Option<f64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDetail {
    pub summary: ActivitySummary,
    pub track: Vec<TrackPoint>,
    pub pause_segments: Vec<PauseSegment>,
    pub original_sample_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySampleQuery {
    pub distance_min_km: Option<f64>,
    pub distance_max_km: Option<f64>,
    pub max_samples: Option<usize>,
    pub hide_pauses: Option<bool>,
    pub downsample: Option<bool>,
}

impl Default for ActivitySampleQuery {
    fn default() -> Self {
        Self {
            distance_min_km: None,
            distance_max_km: None,
            max_samples: None,
            hide_pauses: None,
            downsample: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySamplesResponse {
    pub samples: Vec<ActivitySample>,
    pub original_sample_count: usize,
    pub matching_sample_count: usize,
    pub returned_sample_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AerobicDecouplingRangeAxis {
    ElapsedTime,
    MovingTime,
    Distance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AerobicDecouplingRange {
    pub axis: AerobicDecouplingRangeAxis,
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AerobicDecouplingRequest {
    pub activity_id: i64,
    #[serde(default)]
    pub range: Option<AerobicDecouplingRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AerobicDecouplingResponse {
    pub pace_hr_decoupling_pct: Option<f64>,
    pub heart_rate_drift_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapFilters {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub category: Option<String>,
    pub sport_type: Option<String>,
    pub activity_ids: Option<Vec<i64>>,
    pub max_points: Option<usize>,
}

impl Default for HeatmapFilters {
    fn default() -> Self {
        Self {
            start_date: None,
            end_date: None,
            category: None,
            sport_type: None,
            activity_ids: None,
            max_points: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapData {
    pub tracks: Vec<Vec<TrackPoint>>,
    pub activity_count: usize,
    pub original_point_count: usize,
    pub returned_point_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryActivitySummary {
    pub country_code: String,
    pub numeric_code: u32,
    pub name: String,
    pub duration_seconds: f64,
    pub activity_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryActivityBounds {
    pub min_lat: f64,
    pub min_lon: f64,
    pub max_lat: f64,
    pub max_lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryActivityData {
    pub countries: Vec<CountryActivitySummary>,
    pub activity_count: usize,
    pub located_point_count: usize,
    pub bounds: Option<CountryActivityBounds>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    pub parsed: usize,
    pub total: usize,
    pub current_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDoneEvent {
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedActivity {
    pub start_time: String,
    pub title: String,
    pub category: String,
    pub sport_type: String,
    pub duration_seconds: f64,
    pub moving_duration_seconds: f64,
    pub distance_m: f64,
    pub elevation_gain_m: f64,
    pub avg_speed_mps: Option<f64>,
    pub max_speed_mps: Option<f64>,
    pub avg_hr: Option<f64>,
    pub min_hr: Option<f64>,
    pub max_hr: Option<f64>,
    pub has_gps: bool,
    pub track: Vec<TrackPoint>,
    pub pause_segments: Vec<PauseSegment>,
    pub samples: Vec<ActivitySample>,
    pub original_sample_count: usize,
}

#[derive(Debug, Clone)]
pub struct SourceFileMeta {
    pub source_mtime: i64,
    pub source_size: i64,
    pub parser_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsRunRequest {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    #[serde(default)]
    pub metrics: Vec<AdvancedAnalyticsMetricDefinition>,
    #[serde(default)]
    pub streaks: Vec<AdvancedAnalyticsStreakDefinition>,
    #[serde(default)]
    pub charts: Vec<AdvancedAnalyticsChartDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsMetricDefinition {
    pub id: String,
    pub name: String,
    pub kind: AdvancedAnalyticsMetricKind,
    #[serde(default)]
    pub base: Option<AdvancedAnalyticsBaseMetricDefinition>,
    #[serde(default)]
    pub formula: Option<AdvancedAnalyticsFormulaMetricDefinition>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsMetricKind {
    Base,
    Formula,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsBaseMetricDefinition {
    pub measure: AdvancedAnalyticsBaseMeasure,
    #[serde(default)]
    pub activity_conditions: Vec<AdvancedAnalyticsActivityCondition>,
    #[serde(default)]
    pub activity_condition_groups: Vec<AdvancedAnalyticsActivityConditionGroup>,
    #[serde(default = "default_advanced_analytics_condition_join")]
    pub activity_condition_join: AdvancedAnalyticsConditionJoin,
    #[serde(default)]
    pub sample_conditions: Vec<AdvancedAnalyticsSampleCondition>,
    #[serde(default)]
    pub sample_condition_groups: Vec<AdvancedAnalyticsSampleConditionGroup>,
    #[serde(default = "default_advanced_analytics_condition_join")]
    pub sample_condition_join: AdvancedAnalyticsConditionJoin,
    #[serde(default)]
    pub minimum_sample_match_seconds: Option<f64>,
    #[serde(default)]
    pub default_chart_granularity: Option<AdvancedAnalyticsGranularity>,
    #[serde(default)]
    pub display_unit: Option<String>,
}

fn default_advanced_analytics_condition_join() -> AdvancedAnalyticsConditionJoin {
    AdvancedAnalyticsConditionJoin::And
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsConditionJoin {
    And,
    Or,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsActivityConditionGroup {
    pub id: String,
    #[serde(default)]
    pub conditions: Vec<AdvancedAnalyticsActivityCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsSampleConditionGroup {
    pub id: String,
    #[serde(default)]
    pub conditions: Vec<AdvancedAnalyticsSampleCondition>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsBaseMeasure {
    ActivitiesCount,
    ActiveDaysCount,
    DistanceSum,
    DurationSum,
    MovingTimeSum,
    ElevationGainSum,
    SampleTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsFormulaMetricDefinition {
    pub left_metric_id: String,
    pub operator: AdvancedAnalyticsFormulaOperator,
    pub right_metric_id: String,
    #[serde(default)]
    pub display_unit: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsFormulaOperator {
    Add,
    Subtract,
    Divide,
    Percent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsActivityCondition {
    pub id: String,
    pub field: AdvancedAnalyticsActivityConditionField,
    pub operator: AdvancedAnalyticsActivityConditionOperator,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub values: Option<Vec<String>>,
    #[serde(default)]
    pub number_value: Option<f64>,
    #[serde(default)]
    pub bool_value: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsActivityConditionField {
    Title,
    Category,
    SportType,
    DistanceM,
    DurationSeconds,
    MovingDurationSeconds,
    ElevationGainM,
    AvgHr,
    MaxHr,
    HasGps,
    Weekday,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsActivityConditionOperator {
    Contains,
    ContainsAny,
    ContainsAll,
    Equals,
    StartsWith,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    NumberEquals,
    NotEquals,
    Is,
    IsNot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsSampleCondition {
    pub id: String,
    pub field: AdvancedAnalyticsSampleConditionField,
    pub operator: AdvancedAnalyticsSampleConditionOperator,
    #[serde(default)]
    pub number_value: Option<f64>,
    #[serde(default)]
    pub zone: Option<u8>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsSampleConditionField {
    HeartRate,
    HeartRateZone,
    PowerWatts,
    Cadence,
    SpeedMps,
    PaceMinPerKm,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsSampleConditionOperator {
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    NumberEquals,
    NotEquals,
    Is,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsStreakDefinition {
    pub id: String,
    pub name: String,
    pub metric_id: String,
    #[serde(default)]
    pub additional_metric_ids: Vec<String>,
    pub period: AdvancedAnalyticsPeriod,
    pub threshold_operator: AdvancedAnalyticsThresholdOperator,
    pub threshold_value: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsPeriod {
    Day,
    Week,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsThresholdOperator {
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Equals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsChartDefinition {
    pub id: String,
    pub name: String,
    pub chart_type: AdvancedAnalyticsChartType,
    #[serde(default)]
    pub metric_ids: Vec<String>,
    pub granularity: AdvancedAnalyticsGranularity,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsChartType {
    Bar,
    Line,
    StackedBar,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsGranularity {
    Day,
    Week,
    Month,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsRunResponse {
    pub metric_results: HashMap<String, AdvancedAnalyticsMetricResult>,
    pub streak_results: HashMap<String, AdvancedAnalyticsStreakResult>,
    pub chart_results: HashMap<String, AdvancedAnalyticsChartResult>,
    #[serde(default)]
    pub global_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsMetricResult {
    pub metric_id: String,
    pub name: String,
    pub scalar_value: Option<f64>,
    pub unit: Option<String>,
    pub series_by_granularity: AdvancedAnalyticsSeriesByGranularity,
    #[serde(default)]
    pub sample_time_preview: Option<AdvancedAnalyticsSampleTimePreview>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsSampleTimePreview {
    pub minimum_continuous_match_seconds: f64,
    pub considered_activity_count: usize,
    pub sampled_activity_count: usize,
    #[serde(default)]
    pub activities: Vec<AdvancedAnalyticsSampleTimeActivityPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsSampleTimeActivityPreview {
    pub activity_id: i64,
    pub activity_start: String,
    pub activity_title: String,
    pub total_tracked_seconds: f64,
    pub included_seconds: f64,
    pub filtered_out_seconds: f64,
    #[serde(default)]
    pub segments: Vec<AdvancedAnalyticsSampleTimeSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsSampleTimeSegment {
    pub start_elapsed_seconds: f64,
    pub end_elapsed_seconds: f64,
    pub duration_seconds: f64,
    pub status: AdvancedAnalyticsSampleTimeSegmentStatus,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsSampleTimeSegmentStatus {
    Included,
    FilteredOut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsSeriesByGranularity {
    #[serde(default)]
    pub day: Vec<AdvancedAnalyticsBucketPoint>,
    #[serde(default)]
    pub week: Vec<AdvancedAnalyticsBucketPoint>,
    #[serde(default)]
    pub month: Vec<AdvancedAnalyticsBucketPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsBucketPoint {
    pub key: String,
    pub label: String,
    pub value: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedAnalyticsStreakStatus {
    Active,
    Pending,
    Broken,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsStreakResult {
    pub streak_id: String,
    pub name: String,
    pub count: usize,
    #[serde(default)]
    pub longest: usize,
    pub status: AdvancedAnalyticsStreakStatus,
    pub current_period_key: String,
    pub current_period_value: f64,
    #[serde(default)]
    pub required_metric_values: HashMap<String, f64>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsChartResult {
    pub chart_id: String,
    pub name: String,
    pub chart_type: AdvancedAnalyticsChartType,
    pub granularity: AdvancedAnalyticsGranularity,
    #[serde(default)]
    pub metric_ids: Vec<String>,
    #[serde(default)]
    pub points: Vec<AdvancedAnalyticsChartBucketPoint>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAnalyticsChartBucketPoint {
    pub key: String,
    pub label: String,
    pub values: HashMap<String, Option<f64>>,
}
