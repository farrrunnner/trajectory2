# Trajectory2

Trajectory2 is a local-first activity analyzer with heart-rate drift and aerobic
decoupling metrics, derived from the work of Johnston et al., alongside the original
Trajectory features.

Activity-detail metrics follow the selected chart range, including pause handling,
heart-rate zones, and missing-data checks. See the [developer guide](docs/DEVELOPER_GUIDE.md)
for metric definitions, data-coverage rules, architecture, and extension points.

## Build and install Trajectory2

These instructions build **this repository**, including heart-rate drift and aerobic
decoupling. The original Trajectory downloads and documentation are retained in the
second section below. The packaged application is still named **Trajectory**, version
`0.1.5`, with identifier `com.trajectory.desktop`; it uses the same local settings and
database locations as the original app.

Build on the operating system you intend to use. The workflows in this repository
cover macOS on Apple Silicon and Intel, Windows x64, and Linux x64. They create separate
native builds, not one installer that runs on every platform.

### 1. Get the source and Node.js

Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/en/download)
with npm. Use the latest **Node.js 22** release, at least **22.12.0**. This is the Node
line selected by `.nvmrc` and CI; older Node 22 releases do not satisfy the locked
[Vite 7 requirement](https://v7.vite.dev/guide/#scaffolding-your-first-vite-project).
The package allows newer Node versions, but CI uses Node 22.

Download this repository's source ZIP from **Code → Download ZIP**, extract it,
and open a terminal in the extracted folder. To use Git, copy the repository's HTTPS
clone URL from the **Code** menu, run `git clone` with that URL, and enter the cloned
folder. If you already have the source folder, use it directly.

Run the remaining commands from the folder containing `package.json`.

### 2. Install your platform's build prerequisites

**macOS (Apple Silicon or Intel)**

Install Apple's Command Line Tools and complete the installer before continuing:

```sh
xcode-select --install
```

If they are already installed, `xcode-select -p` should print their location. A full
Xcode installation also works; Command Line Tools are sufficient for this desktop app.
Install [Rust through rustup](https://www.rust-lang.org/tools/install):

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
rustup update stable
```

The app's deployment target is macOS **12.0 or newer**. The default build uses your
Mac's architecture. No Homebrew packages or Apple Developer account are needed for
the default local build; the macOS configuration uses ad-hoc signing.

DMG creation normally asks permission for your terminal to control Finder. Allow
that request, or use `CI=true npm run tauri -- build -- --locked` for the build in
step 3 to skip the cosmetic Finder layout. This still produces the `.app` and `.dmg`.

**Windows (Windows 10/11, x64)**

1. Install [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
   Select **Desktop development with C++**, including the MSVC x64/x86 compiler tools
   and a Windows 10 or 11 SDK.
2. Install the [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)
   if it is not already present.
3. Install [rustup for Windows](https://www.rust-lang.org/tools/install), using the
   **MSVC** host toolchain (`x86_64-pc-windows-msvc`). Open a new PowerShell terminal
   after installation, return to the source folder, and run:

   ```powershell
   rustup set default-host x86_64-pc-windows-msvc
   rustup default stable-msvc
   rustup update stable
   ```

4. The default build creates both NSIS (`.exe`) and WiX (`.msi`) installers. MSI
   packaging needs the Windows **VBScript** optional feature enabled. See
   [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).
   To build only an NSIS installer, use
   `npm run tauri -- build --bundles nsis -- --locked` in step 3.

Use native Windows tools for these commands. A Linux/WSL build produces Linux
artifacts. Tauri downloads its NSIS/WiX packaging tools as needed; a global Tauri CLI
or a separate manual installation of those packagers is not required.
If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm` in the commands below,
or run them in Command Prompt.

**Linux (desktop, x64)**

Ubuntu **22.04 or newer** and Debian **12 or newer** have the required WebKitGTK 4.1
packages. From this source folder, run the same dependency installer used by CI:

```sh
bash scripts/install-tauri-linux-deps.sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
rustup update stable
export APPIMAGE_EXTRACT_AND_RUN=1
```

The helper installs the C/C++ toolchain, `pkg-config`, GTK 3, WebKitGTK **4.1**,
Tauri's native library prerequisites, and the download/image/packaging tools.
It uses `sudo` unless run as root. `APPIMAGE_EXTRACT_AND_RUN=1` lets the AppImage
packaging tools run without requiring a FUSE mount on the build machine.

On other distributions, install the corresponding packages from
[Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux), plus
`pkg-config` and `patchelf`. The apt helper is only for Ubuntu/Debian. Run development
builds in a graphical desktop session. For distributable Linux bundles, CI uses
Ubuntu 22.04: building on a newer distribution can require newer system libraries
on the receiving machine. See [Tauri's AppImage guidance](https://v2.tauri.app/distribute/appimage/).

### 3. Install dependencies, check, and build

On every platform, use these commands from the source root (PowerShell on Windows;
a terminal shell on macOS/Linux):

```sh
node --version
npm --version
rustc --version
cargo --version
npm ci
npm run check
npm run tauri -- build -- --locked
```

Use a current stable Rust toolchain, **1.88 or newer**: the locked `time` dependency
requires Rust 1.88. `rust-toolchain.toml` selects stable and includes `rustfmt` for the
checks. Restart the terminal if `cargo` or `node` is not found after installation.

`npm ci` installs the versions in `package-lock.json`, including the local Tauri CLI.
The final `-- --locked` passes `--locked` to Cargo so the build uses `src-tauri/Cargo.lock`.
The first build needs internet access to download npm packages, Rust crates, and
packaging tools. Keep both lockfiles; do not regenerate them just to install the app.

`npm run check` verifies app/lockfile version alignment, TypeScript, the frontend
regression tests, Rust compilation/tests, and Rust formatting. Tauri then builds
the frontend and Rust application and packages the native installers. **`npm run build`
alone only builds the frontend** and does not produce a desktop app.

The HR-drift feature adds no extra installation steps: its calculations are in this
repository's Rust/TypeScript source. SQLite is compiled into the app through
`rusqlite`'s `bundled` feature. No Python, FIT SDK, database server, API keys, or `.env`
file are needed. Icons and country data are supplied by the repository/dependencies;
map basemaps fetch external tiles at runtime.

### 4. Install the resulting app

Default outputs, relative to the source root:

| Build platform | Generated files | Installation |
| --- | --- | --- |
| macOS | `src-tauri/target/release/bundle/macos/Trajectory.app` and `src-tauri/target/release/bundle/dmg/*.dmg` | Open the DMG and drag Trajectory to Applications, or copy the `.app` there. |
| Windows | `src-tauri/target/release/bundle/nsis/*-setup.exe` and `src-tauri/target/release/bundle/msi/*.msi` | Run either installer. WebView2 may be downloaded if missing. |
| Linux | `src-tauri/target/release/bundle/deb/*.deb` and `src-tauri/target/release/bundle/appimage/*.AppImage` | Install the `.deb` with apt, or make the AppImage executable and run it. |

For Linux, choose one of:

```sh
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
```

```sh
chmod +x src-tauri/target/release/bundle/appimage/*.AppImage
./src-tauri/target/release/bundle/appimage/*.AppImage
```

If an AppImage cannot mount through FUSE, run it with
[`--appimage-extract-and-run`](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#extract-and-run-type-2-appimages).
Linux builds need a graphical session and compatible system libraries even when
packaged as an AppImage. Node and Rust are build tools; end users do not need them
to run an installed app.

The default macOS bundles are ad-hoc signed, not notarized; Windows installers are
unsigned. For a macOS build you trust that Gatekeeper blocks, use Apple's
[Open Anyway procedure](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).

For development, run `npm run tauri -- dev` after installing the prerequisites and
running `npm ci`. The standalone Vite browser preview cannot provide Tauri's native
file/database commands. See the [Trajectory2 developer guide](docs/DEVELOPER_GUIDE.md)
for build overrides, troubleshooting, and the preview/release workflows.

# Trajectory

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
[![Framework](https://img.shields.io/badge/framework-Tauri%20v2-yellow)](https://tauri.app/)
[![Backend](https://img.shields.io/badge/backend-Rust-orange)](https://www.rust-lang.org/)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-3178c6)](https://reactjs.org/)
[![Version](https://img.shields.io/badge/version-v0.1.5-green)](https://github.com/ericceg/trajectory/releases/latest)


**Powerful local-first workout analyzer that keeps your data private.**
A local-first desktop app for exploring `.tcx`/`.fit` activities with dashboard, maps, streaks and custom analytics.
No cloud sync, no account, no server. Just you and your training data.


Originally created by [Eric Ceglie](https://github.com/ericceg/trajectory).
The motivation and personal workflow below are the original author's account.

## Why I Built This

There is no single reason for why I built Trajectory, but rather a combination of factors:

- I wanted a local-first solution to analyze my workout data without relying on cloud platforms or accounts.
- I wanted to get the most out of my workout data. Having collected so many data points over the years, I wanted a way to explore and analyze it in more depth, beyond what the usual fitness platforms offer (and more tailored to my needs). See [Advanced Analytics](#advanced-analytics) for more details and some useful examples.
- I wanted to learn about Tauri and Rust by building a real-world app.
- Last but not least, I was inspired by the "you can just do things" philosophy expressed by [Peter Steinberger](https://github.com/steipete) and many others.



## Installation (IMPORTANT: THE INSTRUCTIONS HERE ARE ONLY FOR THE ORIGINAL VERSION (WITHOUT HR DRIFT). YOU WILL NEED TO DOWNLOAD AND COMPILE TRAJECTORY2 YOURSELF.)

1. Open the original project's [latest release](https://github.com/ericceg/trajectory/releases/latest). For the source in this repository, follow [Developer Setup](#developer-setup-build-from-source).
2. Download the `.dmg` for macOS, `.exe` or `.msi` for Windows, or `.deb` or `.AppImage` for Linux.
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
4. Use **Activities** to filter, sort, and inspect individual workouts. Select or zoom a chart range to see segment metrics; **Show Full Workout** restores the activity totals.
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
It contains example definitions, with synthetic IDs and dates, rather than recorded activity data.

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
- Map basemaps are fetched from OpenStreetMap/CARTO at runtime

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
