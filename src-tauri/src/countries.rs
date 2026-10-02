use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

use anyhow::{Context, Result};
use country_boundaries::{CountryBoundaries, LatLon, BOUNDARIES_ODBL_180X90};
use isocountry::CountryCode;
use rusqlite::{params_from_iter, types::Value, Connection};

use crate::models::{
    CountryActivityBounds, CountryActivityData, CountryActivitySummary, HeatmapFilters,
};

#[derive(Debug)]
struct LocatedSample {
    activity_id: i64,
    elapsed_seconds: f64,
    lat: f64,
    lon: f64,
}

#[derive(Default)]
struct MutableCountrySummary {
    duration_seconds: f64,
    activity_ids: HashSet<i64>,
}

#[derive(Default)]
struct MutableBounds {
    min_lat: f64,
    min_lon: f64,
    max_lat: f64,
    max_lon: f64,
    initialized: bool,
}

impl MutableBounds {
    fn include(&mut self, lat: f64, lon: f64) {
        if !self.initialized {
            self.min_lat = lat;
            self.min_lon = lon;
            self.max_lat = lat;
            self.max_lon = lon;
            self.initialized = true;
            return;
        }

        self.min_lat = self.min_lat.min(lat);
        self.min_lon = self.min_lon.min(lon);
        self.max_lat = self.max_lat.max(lat);
        self.max_lon = self.max_lon.max(lon);
    }

    fn finish(self) -> Option<CountryActivityBounds> {
        self.initialized.then_some(CountryActivityBounds {
            min_lat: self.min_lat,
            min_lon: self.min_lon,
            max_lat: self.max_lat,
            max_lon: self.max_lon,
        })
    }
}

fn boundaries() -> Result<&'static CountryBoundaries> {
    static BOUNDARIES: OnceLock<CountryBoundaries> = OnceLock::new();

    if let Some(boundaries) = BOUNDARIES.get() {
        return Ok(boundaries);
    }

    let parsed = CountryBoundaries::from_reader(BOUNDARIES_ODBL_180X90)
        .context("failed loading bundled country boundaries")?;
    let _ = BOUNDARIES.set(parsed);
    Ok(BOUNDARIES
        .get()
        .expect("country boundaries should be initialized"))
}

fn country_code_at(
    boundaries: &'static CountryBoundaries,
    lat: f64,
    lon: f64,
) -> Option<&'static str> {
    let position = LatLon::new(lat, lon).ok()?;
    boundaries
        .ids(position)
        .into_iter()
        .rev()
        .find(|id| id.len() == 2 && id.bytes().all(|byte| byte.is_ascii_uppercase()))
}

fn add_duration(
    summaries: &mut HashMap<&'static str, MutableCountrySummary>,
    country_code: &'static str,
    seconds: f64,
) {
    if seconds.is_finite() && seconds > 0.0 {
        summaries.entry(country_code).or_default().duration_seconds += seconds;
    }
}

pub fn get_country_activity_data(
    conn: &Connection,
    filters: &HeatmapFilters,
) -> Result<CountryActivityData> {
    let boundaries = boundaries()?;
    let mut sql = String::from(
        r#"
    SELECT activities.id, activity_samples.elapsed_seconds, activity_samples.lat, activity_samples.lon
    FROM activities
    JOIN activity_samples ON activity_samples.activity_id = activities.id
    WHERE activities.has_gps = 1
      AND activity_samples.lat IS NOT NULL
      AND activity_samples.lon IS NOT NULL
    "#,
    );
    let mut params: Vec<Value> = Vec::new();

    if let Some(start_date) = &filters.start_date {
        sql.push_str(" AND date(activities.activity_start) >= date(?)");
        params.push(Value::Text(start_date.clone()));
    }

    if let Some(end_date) = &filters.end_date {
        sql.push_str(" AND date(activities.activity_start) <= date(?)");
        params.push(Value::Text(end_date.clone()));
    }

    if let Some(category) = &filters.category {
        sql.push_str(" AND activities.category = ?");
        params.push(Value::Text(category.clone()));
    }

    if let Some(sport_type) = &filters.sport_type {
        sql.push_str(" AND activities.sport_type = ?");
        params.push(Value::Text(sport_type.clone()));
    }

    if let Some(activity_ids) = filters.activity_ids.as_ref().filter(|ids| !ids.is_empty()) {
        sql.push_str(" AND activities.id IN (");
        for (index, activity_id) in activity_ids.iter().enumerate() {
            if index > 0 {
                sql.push_str(", ");
            }
            sql.push('?');
            params.push(Value::Integer(*activity_id));
        }
        sql.push(')');
    }

    sql.push_str(" ORDER BY activities.id, activity_samples.elapsed_seconds");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(LocatedSample {
            activity_id: row.get(0)?,
            elapsed_seconds: row.get(1)?,
            lat: row.get(2)?,
            lon: row.get(3)?,
        })
    })?;

    let mut summaries = HashMap::<&'static str, MutableCountrySummary>::new();
    let mut activity_ids = HashSet::<i64>::new();
    let mut bounds = MutableBounds::default();
    let mut previous: Option<(i64, f64, Option<&'static str>)> = None;
    let mut located_point_count = 0_usize;

    for row in rows {
        let sample = row?;
        activity_ids.insert(sample.activity_id);
        bounds.include(sample.lat, sample.lon);

        let country_code = country_code_at(boundaries, sample.lat, sample.lon);
        if let Some(country_code) = country_code {
            located_point_count += 1;
            summaries
                .entry(country_code)
                .or_default()
                .activity_ids
                .insert(sample.activity_id);
        }

        if let Some((previous_activity_id, previous_elapsed, previous_country_code)) = previous {
            if previous_activity_id == sample.activity_id {
                let interval_seconds = sample.elapsed_seconds - previous_elapsed;
                match (previous_country_code, country_code) {
                    (Some(previous_code), Some(current_code)) if previous_code == current_code => {
                        add_duration(&mut summaries, current_code, interval_seconds);
                    }
                    (Some(previous_code), Some(current_code)) => {
                        add_duration(&mut summaries, previous_code, interval_seconds / 2.0);
                        add_duration(&mut summaries, current_code, interval_seconds / 2.0);
                    }
                    (Some(previous_code), None) => {
                        add_duration(&mut summaries, previous_code, interval_seconds / 2.0);
                    }
                    (None, Some(current_code)) => {
                        add_duration(&mut summaries, current_code, interval_seconds / 2.0);
                    }
                    (None, None) => {}
                }
            }
        }

        previous = Some((sample.activity_id, sample.elapsed_seconds, country_code));
    }

    let mut countries = summaries
        .into_iter()
        .filter_map(|(country_code, summary)| {
            let country = CountryCode::for_alpha2(country_code).ok()?;
            Some(CountryActivitySummary {
                country_code: country.alpha2().to_owned(),
                numeric_code: country.numeric_id(),
                name: country.name().to_owned(),
                duration_seconds: summary.duration_seconds,
                activity_count: summary.activity_ids.len(),
            })
        })
        .collect::<Vec<_>>();
    countries.sort_by(|left, right| {
        right
            .duration_seconds
            .total_cmp(&left.duration_seconds)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(CountryActivityData {
        countries,
        activity_count: activity_ids.len(),
        located_point_count,
        bounds: bounds.finish(),
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use crate::models::HeatmapFilters;

    use super::{boundaries, country_code_at, get_country_activity_data};

    #[test]
    fn resolves_top_level_country_codes() {
        let boundaries = boundaries().expect("bundled boundaries should load");

        assert_eq!(country_code_at(boundaries, 46.948, 7.4474), Some("CH"));
        assert_eq!(country_code_at(boundaries, 32.7816, -96.7954), Some("US"));
        assert_eq!(country_code_at(boundaries, 0.0, -140.0), None);
    }

    #[test]
    fn aggregates_visits_and_elapsed_time() {
        let conn = Connection::open_in_memory().expect("in-memory database should open");
        conn.execute_batch(
            r#"
            CREATE TABLE activities (
              id INTEGER PRIMARY KEY,
              activity_start TEXT NOT NULL,
              category TEXT NOT NULL,
              sport_type TEXT NOT NULL,
              has_gps INTEGER NOT NULL
            );
            CREATE TABLE activity_samples (
              activity_id INTEGER NOT NULL,
              elapsed_seconds REAL NOT NULL,
              lat REAL,
              lon REAL
            );

            INSERT INTO activities VALUES (1, '2026-01-10T10:00:00Z', 'Running', 'Running', 1);
            INSERT INTO activities VALUES (2, '2026-02-10T10:00:00Z', 'Biking', 'Cycling', 1);
            INSERT INTO activity_samples VALUES (1, 0, 46.948, 7.4474);
            INSERT INTO activity_samples VALUES (1, 600, 46.95, 7.45);
            INSERT INTO activity_samples VALUES (2, 0, 32.7816, -96.7954);
            INSERT INTO activity_samples VALUES (2, 300, 32.79, -96.79);
            "#,
        )
        .expect("fixtures should be inserted");

        let data = get_country_activity_data(&conn, &HeatmapFilters::default())
            .expect("country totals should be calculated");

        assert_eq!(data.activity_count, 2);
        assert_eq!(data.located_point_count, 4);
        assert_eq!(data.countries.len(), 2);
        assert_eq!(data.countries[0].country_code, "CH");
        assert_eq!(data.countries[0].duration_seconds, 600.0);
        assert_eq!(data.countries[1].country_code, "US");
        assert_eq!(data.countries[1].duration_seconds, 300.0);

        let running_only = get_country_activity_data(
            &conn,
            &HeatmapFilters {
                category: Some("Running".to_owned()),
                ..HeatmapFilters::default()
            },
        )
        .expect("filtered country totals should be calculated");

        assert_eq!(running_only.activity_count, 1);
        assert_eq!(running_only.countries.len(), 1);
        assert_eq!(running_only.countries[0].country_code, "CH");
    }
}
