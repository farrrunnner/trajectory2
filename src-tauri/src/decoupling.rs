use anyhow::{anyhow, Result};

use crate::models::{
    ActivitySample, AerobicDecouplingMode, AerobicDecouplingRange, AerobicDecouplingRangeAxis,
    AerobicDecouplingRequest, AerobicDecouplingResponse, PauseSegment,
};

const MAX_OBSERVED_INTERVAL_SECONDS: f64 = 30.0;
const MIN_COVERAGE_RATIO: f64 = 0.8;

#[derive(Debug, Clone, Copy)]
struct IntervalPiece {
    duration_seconds: f64,
    observed: bool,
    heart_rate: Option<f64>,
    speed_mps: Option<f64>,
}

#[derive(Debug, Default)]
struct HalfStats {
    duration_seconds: f64,
    heart_rate_seconds: f64,
    heart_rate_weighted_sum: f64,
    paired_seconds: f64,
    paired_heart_rate_weighted_sum: f64,
    paired_speed_weighted_sum: f64,
}

impl HalfStats {
    fn add(&mut self, piece: IntervalPiece) {
        self.duration_seconds += piece.duration_seconds;
        if !piece.observed {
            return;
        }

        if let Some(heart_rate) = valid_positive(piece.heart_rate) {
            self.heart_rate_seconds += piece.duration_seconds;
            self.heart_rate_weighted_sum += heart_rate * piece.duration_seconds;

            if let Some(speed_mps) = valid_positive(piece.speed_mps) {
                self.paired_seconds += piece.duration_seconds;
                self.paired_heart_rate_weighted_sum += heart_rate * piece.duration_seconds;
                self.paired_speed_weighted_sum += speed_mps * piece.duration_seconds;
            }
        }
    }

    fn average_heart_rate(&self) -> Option<f64> {
        if self.has_coverage(self.heart_rate_seconds) {
            Some(self.heart_rate_weighted_sum / self.heart_rate_seconds)
        } else {
            None
        }
    }

    fn efficiency_factor(&self) -> Option<f64> {
        if !self.has_coverage(self.paired_seconds) {
            return None;
        }
        let average_heart_rate = self.paired_heart_rate_weighted_sum / self.paired_seconds;
        let average_speed = self.paired_speed_weighted_sum / self.paired_seconds;
        if average_heart_rate > 0.0 && average_speed > 0.0 {
            Some(average_speed / average_heart_rate)
        } else {
            None
        }
    }

    fn has_coverage(&self, covered_seconds: f64) -> bool {
        self.duration_seconds > 0.0 && covered_seconds / self.duration_seconds >= MIN_COVERAGE_RATIO
    }
}

pub fn calculate_aerobic_decoupling(
    request: &AerobicDecouplingRequest,
    samples: &[ActivitySample],
    pause_segments: &[PauseSegment],
) -> Result<AerobicDecouplingResponse> {
    match request.mode {
        AerobicDecouplingMode::Outdoor => {
            if let Some(range) = &request.outdoor_range {
                validate_range(range)?;
            }
            let pieces =
                build_interval_pieces(samples, pause_segments, request.outdoor_range.as_ref());
            let (first, second) = split_pieces_in_half(&pieces);
            Ok(AerobicDecouplingResponse {
                pace_hr_decoupling_pct: percentage_decline(
                    first.efficiency_factor(),
                    second.efficiency_factor(),
                ),
                heart_rate_drift_pct: percentage_increase(
                    first.average_heart_rate(),
                    second.average_heart_rate(),
                ),
            })
        }
        AerobicDecouplingMode::Treadmill => {
            let section_one = request
                .treadmill_section_one
                .as_ref()
                .ok_or_else(|| anyhow!("treadmill section one is required"))?;
            let section_two = request
                .treadmill_section_two
                .as_ref()
                .ok_or_else(|| anyhow!("treadmill section two is required"))?;
            validate_range(section_one)?;
            validate_range(section_two)?;
            if section_one.axis != AerobicDecouplingRangeAxis::MovingTime
                || section_two.axis != AerobicDecouplingRangeAxis::MovingTime
            {
                return Err(anyhow!("treadmill sections must use moving time"));
            }
            if section_two.min < section_one.max {
                return Err(anyhow!("treadmill section two must follow section one"));
            }

            let first = summarize_pieces(&build_interval_pieces(
                samples,
                pause_segments,
                Some(section_one),
            ));
            let second = summarize_pieces(&build_interval_pieces(
                samples,
                pause_segments,
                Some(section_two),
            ));
            Ok(AerobicDecouplingResponse {
                pace_hr_decoupling_pct: None,
                heart_rate_drift_pct: percentage_increase(
                    first.average_heart_rate(),
                    second.average_heart_rate(),
                ),
            })
        }
    }
}

fn validate_range(range: &AerobicDecouplingRange) -> Result<()> {
    if !range.min.is_finite() || !range.max.is_finite() || range.min < 0.0 || range.max <= range.min
    {
        return Err(anyhow!(
            "decoupling range must be finite, non-negative, and increasing"
        ));
    }
    Ok(())
}

fn build_interval_pieces(
    samples: &[ActivitySample],
    pause_segments: &[PauseSegment],
    range: Option<&AerobicDecouplingRange>,
) -> Vec<IntervalPiece> {
    let mut pieces = Vec::new();

    for pair in samples.windows(2) {
        let current = &pair[0];
        let next = &pair[1];
        let start = current.elapsed_seconds;
        let end = next.elapsed_seconds;
        let raw_duration = end - start;
        if !start.is_finite()
            || !end.is_finite()
            || !raw_duration.is_finite()
            || raw_duration <= 0.0
        {
            continue;
        }

        let observed = raw_duration <= MAX_OBSERVED_INTERVAL_SECONDS;
        let speed_mps = interval_speed(current, next, raw_duration);
        let heart_rate = valid_positive(current.heart_rate);

        for (active_start, active_end) in active_segments(start, end, pause_segments) {
            let Some(duration_seconds) = clipped_segment_duration(
                active_start,
                active_end,
                current,
                next,
                start,
                raw_duration,
                pause_segments,
                range,
            ) else {
                continue;
            };

            pieces.push(IntervalPiece {
                duration_seconds,
                observed,
                heart_rate,
                speed_mps,
            });
        }
    }

    pieces
}

fn active_segments(start: f64, end: f64, pause_segments: &[PauseSegment]) -> Vec<(f64, f64)> {
    let mut segments = vec![(start, end)];
    for pause in pause_segments {
        let pause_start = pause.start_elapsed_seconds.max(start);
        let pause_end = pause.end_elapsed_seconds.min(end);
        if pause_end <= pause_start {
            continue;
        }

        let mut next_segments = Vec::new();
        for (segment_start, segment_end) in segments {
            if pause_start > segment_start {
                next_segments.push((segment_start, pause_start.min(segment_end)));
            }
            if pause_end < segment_end {
                next_segments.push((pause_end.max(segment_start), segment_end));
            }
        }
        segments = next_segments;
    }
    segments
        .into_iter()
        .filter(|(segment_start, segment_end)| segment_end > segment_start)
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn clipped_segment_duration(
    active_start: f64,
    active_end: f64,
    current: &ActivitySample,
    next: &ActivitySample,
    interval_start: f64,
    interval_duration: f64,
    pause_segments: &[PauseSegment],
    range: Option<&AerobicDecouplingRange>,
) -> Option<f64> {
    let Some(range) = range else {
        return Some(active_end - active_start);
    };

    let (coordinate_start, coordinate_end) = match range.axis {
        AerobicDecouplingRangeAxis::ElapsedTime => (active_start, active_end),
        AerobicDecouplingRangeAxis::MovingTime => (
            moving_time_at(active_start, pause_segments),
            moving_time_at(active_end, pause_segments),
        ),
        AerobicDecouplingRangeAxis::Distance => {
            let start_distance = valid_non_negative(current.distance_m)? / 1000.0;
            let end_distance = valid_non_negative(next.distance_m)? / 1000.0;
            if end_distance <= start_distance {
                return None;
            }
            let active_start_fraction = (active_start - interval_start) / interval_duration;
            let active_end_fraction = (active_end - interval_start) / interval_duration;
            (
                start_distance + (end_distance - start_distance) * active_start_fraction,
                start_distance + (end_distance - start_distance) * active_end_fraction,
            )
        }
    };

    if !coordinate_start.is_finite()
        || !coordinate_end.is_finite()
        || coordinate_end <= coordinate_start
    {
        return None;
    }

    let clipped_start = coordinate_start.max(range.min);
    let clipped_end = coordinate_end.min(range.max);
    if clipped_end <= clipped_start {
        return None;
    }

    let coordinate_span = coordinate_end - coordinate_start;
    let segment_duration = active_end - active_start;
    Some(segment_duration * (clipped_end - clipped_start) / coordinate_span)
}

fn moving_time_at(elapsed_seconds: f64, pause_segments: &[PauseSegment]) -> f64 {
    let paused_seconds: f64 = pause_segments
        .iter()
        .map(|pause| {
            let start = pause.start_elapsed_seconds.max(0.0);
            let end = pause.end_elapsed_seconds.min(elapsed_seconds);
            (end - start).max(0.0)
        })
        .sum();
    (elapsed_seconds - paused_seconds).max(0.0)
}

fn interval_speed(
    current: &ActivitySample,
    next: &ActivitySample,
    duration_seconds: f64,
) -> Option<f64> {
    if let (Some(start_distance), Some(end_distance)) = (
        valid_non_negative(current.distance_m),
        valid_non_negative(next.distance_m),
    ) {
        let distance_delta = end_distance - start_distance;
        if distance_delta > 0.0 {
            return Some(distance_delta / duration_seconds);
        }
    }
    valid_positive(current.speed_mps)
}

fn split_pieces_in_half(pieces: &[IntervalPiece]) -> (HalfStats, HalfStats) {
    let total_duration: f64 = pieces.iter().map(|piece| piece.duration_seconds).sum();
    let midpoint = total_duration / 2.0;
    let mut first = HalfStats::default();
    let mut second = HalfStats::default();
    let mut elapsed = 0.0;

    for piece in pieces {
        let first_duration = (midpoint - elapsed).clamp(0.0, piece.duration_seconds);
        if first_duration > 0.0 {
            first.add(IntervalPiece {
                duration_seconds: first_duration,
                ..*piece
            });
        }
        let second_duration = piece.duration_seconds - first_duration;
        if second_duration > 0.0 {
            second.add(IntervalPiece {
                duration_seconds: second_duration,
                ..*piece
            });
        }
        elapsed += piece.duration_seconds;
    }

    (first, second)
}

fn summarize_pieces(pieces: &[IntervalPiece]) -> HalfStats {
    let mut stats = HalfStats::default();
    for piece in pieces {
        stats.add(*piece);
    }
    stats
}

fn percentage_increase(first: Option<f64>, second: Option<f64>) -> Option<f64> {
    let (Some(first), Some(second)) = (first, second) else {
        return None;
    };
    if first > 0.0 {
        Some((second / first - 1.0) * 100.0)
    } else {
        None
    }
}

fn percentage_decline(first: Option<f64>, second: Option<f64>) -> Option<f64> {
    let (Some(first), Some(second)) = (first, second) else {
        return None;
    };
    if first > 0.0 {
        Some((1.0 - second / first) * 100.0)
    } else {
        None
    }
}

fn valid_positive(value: Option<f64>) -> Option<f64> {
    value.filter(|entry| entry.is_finite() && *entry > 0.0)
}

fn valid_non_negative(value: Option<f64>) -> Option<f64> {
    value.filter(|entry| entry.is_finite() && *entry >= 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(
        elapsed: f64,
        distance: Option<f64>,
        speed: Option<f64>,
        hr: Option<f64>,
    ) -> ActivitySample {
        ActivitySample {
            elapsed_seconds: elapsed,
            distance_m: distance,
            speed_mps: speed,
            heart_rate: hr,
            cadence: None,
            power_watts: None,
            altitude_m: None,
            lat: None,
            lon: None,
            timestamp: None,
        }
    }

    fn outdoor_request(range: Option<AerobicDecouplingRange>) -> AerobicDecouplingRequest {
        AerobicDecouplingRequest {
            activity_id: 1,
            mode: AerobicDecouplingMode::Outdoor,
            outdoor_range: range,
            treadmill_section_one: None,
            treadmill_section_two: None,
        }
    }

    fn constant_half_samples(
        first_hr: f64,
        second_hr: f64,
        first_speed: f64,
        second_speed: f64,
    ) -> Vec<ActivitySample> {
        (0..=10)
            .map(|index| {
                let elapsed = f64::from(index) * 10.0;
                let speed = if index < 5 { first_speed } else { second_speed };
                let hr = if index < 5 { first_hr } else { second_hr };
                sample(elapsed, None, Some(speed), Some(hr))
            })
            .collect()
    }

    fn assert_close(actual: Option<f64>, expected: f64) {
        let actual = actual.expect("expected result");
        assert!((actual - expected).abs() < 1e-4, "{actual} != {expected}");
    }

    #[test]
    fn constant_speed_and_heart_rate_produce_zero() {
        let result = calculate_aerobic_decoupling(
            &outdoor_request(None),
            &constant_half_samples(140.0, 140.0, 3.0, 3.0),
            &[],
        )
        .unwrap();
        assert_close(result.pace_hr_decoupling_pct, 0.0);
        assert_close(result.heart_rate_drift_pct, 0.0);
    }

    #[test]
    fn constant_speed_preserves_distinct_decoupling_and_hr_drift_formulas() {
        let result = calculate_aerobic_decoupling(
            &outdoor_request(None),
            &constant_half_samples(140.0, 150.0, 3.0, 3.0),
            &[],
        )
        .unwrap();
        assert_close(result.pace_hr_decoupling_pct, 6.666_666_7);
        assert_close(result.heart_rate_drift_pct, 7.142_857_1);

        let result = calculate_aerobic_decoupling(
            &outdoor_request(None),
            &constant_half_samples(144.0, 151.0, 3.0, 3.0),
            &[],
        )
        .unwrap();
        assert_close(result.pace_hr_decoupling_pct, 4.635_761_6);
        assert_close(result.heart_rate_drift_pct, 4.861_111_1);
    }

    #[test]
    fn speed_loss_and_improvement_keep_the_expected_sign() {
        let result = calculate_aerobic_decoupling(
            &outdoor_request(None),
            &constant_half_samples(140.0, 140.0, 3.0, 2.7),
            &[],
        )
        .unwrap();
        assert_close(result.pace_hr_decoupling_pct, 10.0);

        let improved = calculate_aerobic_decoupling(
            &outdoor_request(None),
            &constant_half_samples(150.0, 140.0, 3.0, 3.0),
            &[],
        )
        .unwrap();
        assert!(improved.pace_hr_decoupling_pct.unwrap() < 0.0);
        assert!(improved.heart_rate_drift_pct.unwrap() < 0.0);
    }

    #[test]
    fn irregular_intervals_are_time_weighted_and_midpoint_intervals_are_split() {
        let samples = vec![
            sample(0.0, None, Some(3.0), Some(100.0)),
            sample(10.0, None, Some(3.0), Some(200.0)),
            sample(30.0, None, Some(3.0), Some(200.0)),
            sample(40.0, None, Some(3.0), Some(200.0)),
        ];
        let result = calculate_aerobic_decoupling(&outdoor_request(None), &samples, &[]).unwrap();
        assert_close(result.heart_rate_drift_pct, 33.333_333_3);
    }

    #[test]
    fn pauses_are_excluded() {
        let samples: Vec<_> = (0..=10)
            .map(|index| {
                let elapsed = f64::from(index) * 10.0;
                let hr = if elapsed < 40.0 {
                    100.0
                } else if elapsed < 60.0 {
                    250.0
                } else {
                    200.0
                };
                sample(elapsed, None, Some(3.0), Some(hr))
            })
            .collect();
        let pauses = vec![PauseSegment {
            start_elapsed_seconds: 40.0,
            end_elapsed_seconds: 60.0,
            duration_seconds: 20.0,
            start_timestamp: None,
            end_timestamp: None,
        }];
        let result =
            calculate_aerobic_decoupling(&outdoor_request(None), &samples, &pauses).unwrap();
        assert_close(result.heart_rate_drift_pct, 100.0);
    }

    #[test]
    fn long_gaps_reduce_coverage_and_missing_speed_only_blocks_decoupling() {
        let sparse = vec![
            sample(0.0, None, Some(3.0), Some(140.0)),
            sample(10.0, None, Some(3.0), Some(140.0)),
            sample(100.0, None, Some(3.0), Some(150.0)),
            sample(110.0, None, Some(3.0), Some(150.0)),
        ];
        let sparse_result =
            calculate_aerobic_decoupling(&outdoor_request(None), &sparse, &[]).unwrap();
        assert_eq!(sparse_result.pace_hr_decoupling_pct, None);
        assert_eq!(sparse_result.heart_rate_drift_pct, None);

        let missing_speed = constant_half_samples(140.0, 150.0, 0.0, 0.0);
        let missing_speed_result =
            calculate_aerobic_decoupling(&outdoor_request(None), &missing_speed, &[]).unwrap();
        assert_eq!(missing_speed_result.pace_hr_decoupling_pct, None);
        assert!(missing_speed_result.heart_rate_drift_pct.is_some());
    }

    #[test]
    fn selected_elapsed_moving_and_distance_ranges_include_expected_intervals() {
        let samples: Vec<_> = (0..=12)
            .map(|index| {
                let elapsed = f64::from(index) * 10.0;
                let hr = if index < 6 { 140.0 } else { 150.0 };
                sample(elapsed, Some(elapsed * 3.0), Some(3.0), Some(hr))
            })
            .collect();

        for range in [
            AerobicDecouplingRange {
                axis: AerobicDecouplingRangeAxis::ElapsedTime,
                min: 20.0,
                max: 100.0,
            },
            AerobicDecouplingRange {
                axis: AerobicDecouplingRangeAxis::MovingTime,
                min: 20.0,
                max: 100.0,
            },
            AerobicDecouplingRange {
                axis: AerobicDecouplingRangeAxis::Distance,
                min: 0.06,
                max: 0.3,
            },
        ] {
            let result =
                calculate_aerobic_decoupling(&outdoor_request(Some(range)), &samples, &[]).unwrap();
            assert!(result.pace_hr_decoupling_pct.is_some());
            assert!(result.heart_rate_drift_pct.is_some());
        }
    }

    #[test]
    fn treadmill_uses_two_moving_time_sections() {
        let samples = constant_half_samples(140.0, 150.0, 3.0, 3.0);
        let request = AerobicDecouplingRequest {
            activity_id: 1,
            mode: AerobicDecouplingMode::Treadmill,
            outdoor_range: None,
            treadmill_section_one: Some(AerobicDecouplingRange {
                axis: AerobicDecouplingRangeAxis::MovingTime,
                min: 0.0,
                max: 50.0,
            }),
            treadmill_section_two: Some(AerobicDecouplingRange {
                axis: AerobicDecouplingRangeAxis::MovingTime,
                min: 50.0,
                max: 100.0,
            }),
        };
        let result = calculate_aerobic_decoupling(&request, &samples, &[]).unwrap();
        assert_eq!(result.pace_hr_decoupling_pct, None);
        assert_close(result.heart_rate_drift_pct, 7.142_857_1);
    }
}
