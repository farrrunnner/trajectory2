# Trajectory

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
[![Framework](https://img.shields.io/badge/framework-Tauri%20v2-yellow)](https://tauri.app/)
[![Backend](https://img.shields.io/badge/backend-Rust-orange)](https://www.rust-lang.org/)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-3178c6)](https://reactjs.org/)
[![Version](https://img.shields.io/badge/version-v2-green)](https://github.com/farrrunnner/trajectory2)


**Powerful local-first workout analyzer that keeps your data private.**
A local-first desktop app for exploring `.tcx`/`.fit` activities with dashboard, maps, streaks and custom analytics.
No cloud sync, no account, no server. Just you and your training data.


## Why I Built This

[Trajectory2](https://github.com/farrrunnner/trajectory2):

Added heart rate drift metric as discussed by Scott Johnston et al in Training for the Uphill Athlete.

Added code to dynamically display the metrics for the selected workout section (rather than for the entire session).

[Trajectory (Original App)](https://github.com/ericceg/trajectory):

There is no single reason for why I built Trajectory, but rather a combination of factors:

- I wanted a local-first solution to analyze my workout data without relying on cloud platforms or accounts.
- I wanted to get the most out of my workout data. Having collected so many data points over the years, I wanted a way to explore and analyze it in more depth, beyond what the usual fitness platforms offer (and more tailored to my needs). See [Advanced Analytics](#advanced-analytics) for more details and some useful examples.
- I wanted to learn about Tauri and Rust by building a real-world app.
- Last but not least, I was inspired by the "you can just do things" philosophy expressed by [Peter Steinberger](https://github.com/steipete) and many others.



## Installation

1. Open the [latest release](https://github.com/farrrunnner/trajectory2).
2. [Download the `.dmg` for macOS HERE](https://github.com/farrrunnner/trajectory2/blob/main/Trajectory2.dmg) by clicking the 'Download raw file' button or the 'View raw' button. Or use GitHub Actions to build `.exe` or `.msi` for Windows, or `.deb` or `.AppImage` for Linux.
3. Install and launch the app.

Current builds support Apple Silicon on macOS and 64-bit systems on Windows and Linux.

Notes:
- Release builds are not yet production-signed, so your operating system may show a security warning on first launch.
- If macOS reports that Trajectory is damaged or corrupted, remove the quarantine flag after installation:

  ```bash
  sudo xattr -dr com.apple.quarantine /Applications/Trajectory.app
  ```

- On macOS, if you still cannot open the app, follow the instructions on [Apple's support site](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).



## Usage

1. Launch Trajectory.
2. Select your activity folder containing `.tcx` and/or `.fit` files.
3. Start in **Dashboard** for a quick overview of training load and history.
4. Use **Activities** to filter, sort, and inspect individual workouts.
5. Open **Heatmap** to spot route patterns across all GPS sessions.
6. Use **Advanced Analytics** to define custom metrics, streaks, and charts. See [Advanced Analytics](#advanced-analytics) for more details and examples.
7. Open **Settings** to customize appearance, configure heart-rate zones, and run rescans.


## Recommended Workflow for Apple Ecosystem Users

Here is the workflow I personally use (and would recommend) for athletes in the Apple ecosystem:

1. Set up the iOS app [RunGap](https://www.rungap.com/). This is a powerful workout data manager that can sync up activities from all the usual fitness platforms (Strava, Garmin Connect, Apple Health, etc.). Set it up to sync your workouts to a local folder on your Mac (e.g. via iCloud Drive or Dropbox).

2. Install Trajectory on your Mac. Point it to the same folder where RunGap is syncing your workouts. Done.





## Advanced Analytics

Trajectory allows you to get the most out of your data by providing a simple
yet powerful tool to define custom metrics. 

To get started, navigate to the **Advanced Analytics** section in the sidebar and switch
to the **Configure** mode.
There are three fundamental building blocks to create your custom analytics:

- **Metrics**, which can be subdivided into
    - base metrics and
    - formula metrics
- **Streaks** 
- **Charts**


Each type is explained below.


<details>
<summary>
<b>Metrics</b>
</summary>

**Metrics** are the core building block of the analytics system. They represent individual data points that can be calculated from your workout data. There are two types of metrics:

- **Base Metrics**: These are directly calculated from the raw workout data.
- **Formula Metrics**: These are defined as formulas that can reference other metrics (both base and formula). This allows you to create complex derived metrics based on simpler ones.

A **base metric** allows to measure:

- activities count
- active days count
- distance sum
- duration sum
- moving time sum
- elevation gain sum
- sample time 

After deciding on a base metric, one can also empose conditions such as
title, category, distance, duration and many more. 
Multiple conditions can be combined using AND/OR logic, allowing for highly customized metrics. 
Then the metric is calculated for all activities that satisfy the conditions.
It can be directly displayed (one aggregated value) or it can be used as a building block for more complex metrics, streaks and charts.

The base metric *sample time* works a bit differently from the others. 
It allows for more granular time-based calculations within activities.
One can measure the time spent doing an activity while satisfying certain conditions.
Using AND/OR logic, one can combine conditions of the following types:

- heart rate zone
- heart rate
- power
- cadence
- speed
- pace

On top of that, one can empose a *minimum continuous match time*,
which allows to only count time intervals where the conditions are continuously 
satisfied for at least the specified time.
At the bottom of the configuration page, there is a visual representation of 
which sample times where filtered out (before and after applying the minimum 
continuous match time condition), which can be very useful 
to make sure the metric is configured as intended.


A **formula metric** allows to define a metric as a formula that can reference other metrics (both base and formula).
This allows to create complex derived metrics based on simpler ones.
</details>


<details>
<summary>
<b>Streaks</b>
</summary>

A **streak** tracks consecutive periods where your metrics hit a goal.
You can configure:

- **Period**: day or week
- **Threshold operator**: `>`, `>=`, `<`, `<=`, `=`
- **Threshold value**: numeric target to compare against
- **Required metrics**: one or more metrics that must all pass the threshold (AND logic)

Trajectory then computes:

- **Current streak** (how many consecutive periods up to now satisfy the rule)
- **Longest streak** in your available history
- **Status** (`active`, `pending`, `broken`)
- **Current period value** (with progress toward the configured threshold)

</details>


<details>
<summary>
<b>Charts</b>
</summary>

A **chart view** turns saved metrics into time-bucketed visualizations.
You can configure:

- **Chart type**:
  - **Bar** (exactly 1 metric)
  - **Line** (exactly 1 metric)
  - **Stacked Bar** (2 to 5 metrics)
- **Granularity**: day, week, or month
- **Time range**: all time, rolling windows, or custom dates

Each chart supports interactive zoom on the x-axis and includes a dedicated
preview. Note that the preview shows all data points, while the chart in view mode 
respects the selected time range.

</details>





### Some Examples

All the following examples can be imported using the file
file [`assets/trajectory-advanced-analytics-examples.json`](assets/trajectory-advanced-analytics-examples.json).

1. Let's start with my favorite metric **aerobic time fraction**. 
It measures the fraction of time spent in aerobic heart rate zones during workouts.
It crucially relies on the base metric *sample time* with heart rate zone conditions
and with a minimum continuous match time of 5 minutes (to filter out short intervals that don't really count as aerobic efforts, e.g. during weight training).

2. Another useful metric is the **weekly push/pull streak**. 
I like to do push/pull splits and indicate them in the workout title (e.g. "Push day", "Pull day").
This streak tracks consecutive weeks where I do at least one push day and one pull day, which helps me maintain a balanced routine.

3. Another interesting metric is called **risky ride**. 
It measures the time spent riding faster than 50 km/h, which 
can be useful to convince your loved ones that your hobby is not that dangerous after all.



## Privacy

- Your activity files stay local
- Data is processed on-device
- No account or telemetry backend required

## Platform Support

- macOS on Apple Silicon (`aarch64`)
- Windows 64-bit (`x64`)
- Linux 64-bit (`amd64`)

## Developer Setup (Build From Source)

This section is for contributors and developers.

### Prerequisites

- Node.js 22+
- Rust stable

### Run in development

```bash
npm install
npm run tauri dev
```

### Quality checks

```bash
npm run check
```

### Build production artifacts locally

```bash
npm run tauri build
```

Output artifacts are generated under:

- `src-tauri/target/release/bundle/macos/*.app`
- `src-tauri/target/release/bundle/dmg/*.dmg`
- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/deb/*.deb`
- `src-tauri/target/release/bundle/appimage/*.AppImage`

### Documentation

- Developer guide: [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md)

## Tech Stack

- Tauri v2 + Rust
- React + TypeScript + Vite + Tailwind CSS
- SQLite (local app storage)


## Roadmap

- Route planner.
- Production code signing and macOS notarization.



## License

MIT. See [`LICENSE`](LICENSE).
