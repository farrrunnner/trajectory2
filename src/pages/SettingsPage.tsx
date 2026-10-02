import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { ScanStatusCard } from '@/components/ScanStatusCard';
import { ACCENT_THEME_OPTIONS, DEFAULT_ACCENT_THEME_ID } from '@/lib/theme';
import { useAppStore } from '@/store/useAppStore';
import { useUiStateStore } from '@/store/useUiStateStore';

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const scanning = useAppStore((state) => state.scanning);
  const scanProgress = useAppStore((state) => state.scanProgress);
  const scanDone = useAppStore((state) => state.scanDone);
  const updateImportFolder = useAppStore((state) => state.updateImportFolder);
  const setScanRecursive = useAppStore((state) => state.setScanRecursive);
  const updateDarkMode = useAppStore((state) => state.updateDarkMode);
  const updateAccentTheme = useAppStore((state) => state.updateAccentTheme);
  const updateHeatmapFullOpacity = useAppStore((state) => state.updateHeatmapFullOpacity);
  const updateChartMaxSamples = useAppStore((state) => state.updateChartMaxSamples);
  const updateChartOutlierRemoval = useAppStore((state) => state.updateChartOutlierRemoval);
  const updateHeartRateZoneUpperBoundsBpm = useAppStore(
    (state) => state.updateHeartRateZoneUpperBoundsBpm
  );
  const runScan = useAppStore((state) => state.runScan);
  const activeTab = useUiStateStore((state) => state.settingsActiveTab);
  const setSettingsActiveTab = useUiStateStore((state) => state.setSettingsActiveTab);

  const [error, setError] = useState<string | null>(null);
  const [confirmFullRescan, setConfirmFullRescan] = useState(false);
  const [heartRateZoneDraft, setHeartRateZoneDraft] = useState<string[]>(['120', '140', '160', '180']);
  const [heartRateZoneDirty, setHeartRateZoneDirty] = useState(false);

  useEffect(() => {
    const values = settings?.heartRateZoneUpperBoundsBpm;
    if (!Array.isArray(values) || values.length !== 4) {
      return;
    }

    setHeartRateZoneDraft(values.map((value) => String(value)));
    setHeartRateZoneDirty(false);
  }, [settings?.heartRateZoneUpperBoundsBpm]);

  const handleChooseFolder = async () => {
    const path = await open({ directory: true, multiple: false, title: 'Select Import Folder' });
    if (!path || Array.isArray(path)) {
      return;
    }

    setError(null);
    try {
      await updateImportFolder(path, settings?.scanRecursive ?? true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRescan = async () => {
    setConfirmFullRescan(false);
    setError(null);
    try {
      await runScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirmFullRescan = async () => {
    setError(null);
    try {
      await runScan(true);
      setConfirmFullRescan(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveHeartRateZones = async () => {
    setError(null);

    const parsed = heartRateZoneDraft.map((value) => Number(value.trim()));
    if (parsed.some((value) => !Number.isInteger(value))) {
      setError('Heart rate zone thresholds must be whole numbers in bpm.');
      return;
    }

    const bounds = parsed.map((value) => Math.trunc(value));
    for (let index = 0; index < bounds.length; index += 1) {
      const value = bounds[index];
      if (value < 40 || value > 260) {
        setError(`Zone ${index + 1} upper bound must be between 40 and 260 bpm.`);
        return;
      }
      if (index > 0 && value <= bounds[index - 1]) {
        setError('Zone upper bounds must increase from Z1 through Z4.');
        return;
      }
    }

    try {
      await updateHeartRateZoneUpperBoundsBpm(bounds);
      setHeartRateZoneDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const savedHeartRateBounds =
    settings?.heartRateZoneUpperBoundsBpm?.length === 4
      ? settings.heartRateZoneUpperBoundsBpm
      : [120, 140, 160, 180];
  const previewHeartRateBounds = heartRateZoneDraft.reduce<number[]>((bounds, value, index) => {
    const parsed = Number(value);
    const fallback = savedHeartRateBounds[index];
    const baseValue = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    if (index === 0) {
      bounds.push(Math.max(40, Math.min(260, baseValue)));
      return bounds;
    }

    bounds.push(Math.max(bounds[index - 1] + 1, Math.min(260, baseValue)));
    return bounds;
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Settings</p>
        <h2 className="mt-2 text-3xl font-semibold text-foreground">
          {activeTab === 'import'
            ? 'Import Configuration'
            : activeTab === 'appearance'
              ? 'Appearance'
              : 'Athlete Metrics'}
        </h2>
      </header>

      <section className="rounded-xl border border-border bg-panel p-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSettingsActiveTab('import')}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === 'import'
                ? 'bg-accent text-white'
                : 'text-muted hover:bg-bg hover:text-foreground'
            }`}
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => setSettingsActiveTab('appearance')}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === 'appearance'
                ? 'bg-accent text-white'
                : 'text-muted hover:bg-bg hover:text-foreground'
            }`}
          >
            Appearance
          </button>
          <button
            type="button"
            onClick={() => setSettingsActiveTab('athlete')}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === 'athlete'
                ? 'bg-accent text-white'
                : 'text-muted hover:bg-bg hover:text-foreground'
            }`}
          >
            Athlete Metrics
          </button>
        </div>
      </section>

      {error ? <p className="rounded-lg bg-accent/20 p-3 text-sm text-accent">{error}</p> : null}

      {activeTab === 'import' ? (
        <>
          <section className="rounded-xl border border-border bg-panel p-5">
            <h3 className="text-lg font-semibold text-foreground">Import Folder</h3>
            <p className="mt-2 text-sm text-muted">
              Current folder: {settings?.importFolderPath ?? 'Not set'}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleChooseFolder()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white"
              >
                Choose Folder
              </button>

              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={settings?.scanRecursive ?? true}
                  onChange={(event) => void setScanRecursive(event.target.checked)}
                  className="h-4 w-4 rounded border-border bg-bg"
                />
                Scan recursively
              </label>

              <button
                type="button"
                onClick={() => void handleRescan()}
                disabled={!settings?.importFolderPath || scanning}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted disabled:opacity-50"
              >
                {scanning ? 'Scanning...' : 'Rescan'}
              </button>

              <button
                type="button"
                onClick={() => setConfirmFullRescan(true)}
                disabled={!settings?.importFolderPath || scanning}
                className="rounded-md border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
              >
                {scanning ? 'Scanning...' : 'Clear Cache + Full Rescan'}
              </button>
            </div>

            {confirmFullRescan ? (
              <div className="mt-3 rounded-md border border-accent/30 bg-accent/10 p-3">
                <p className="text-sm text-foreground">
                  This will clear all cached activities, then rebuild from files in your import
                  folder.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmFullRescan(false)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmFullRescan()}
                    disabled={scanning}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Confirm Full Rescan
                  </button>
                </div>
              </div>
            ) : null}

            <p className="mt-3 text-xs text-muted">
              Full rescan clears cached activities first, then re-imports every TCX/FIT file. Use
              this if deleted or previously broken files are still visible.
            </p>

            {settings?.lastScanTimestamp ? (
              <p className="mt-3 text-xs text-muted">Last scan: {settings.lastScanTimestamp}</p>
            ) : null}
          </section>

          <ScanStatusCard scanning={scanning} progress={scanProgress} done={scanDone} />

          {scanDone?.errors.length ? (
            <section className="rounded-xl border border-border bg-panel p-4">
              <h3 className="text-lg font-semibold text-foreground">Scan Errors</h3>
              <ul className="mt-3 space-y-2 text-xs text-accent">
                {scanDone.errors.map((entry) => (
                  <li key={entry} className="rounded-md border border-accent/30 bg-accent/10 p-2">
                    {entry}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : activeTab === 'appearance' ? (
        <section className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-lg font-semibold text-foreground">Theme</h3>
          <div className="mt-4 space-y-5">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={settings?.darkMode ?? false}
                onChange={(event) => void updateDarkMode(event.target.checked)}
                className="h-4 w-4 rounded border-border bg-bg"
              />
              Dark mode
            </label>

            <div>
              <p className="text-sm font-medium text-foreground">Accent color</p>
              <p className="mt-1 text-xs text-muted">
                Applies to buttons, highlights, route overlays, and accent-based charts.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {ACCENT_THEME_OPTIONS.map((theme) => {
                  const selected = (settings?.accentTheme ?? DEFAULT_ACCENT_THEME_ID) === theme.id;

                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => void updateAccentTheme(theme.id)}
                      aria-pressed={selected}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition ${
                        selected
                          ? 'border-accent bg-accent/10 text-foreground'
                          : 'border-border bg-bg/40 text-muted hover:border-accent/40 hover:text-foreground'
                      }`}
                    >
                      <span className="text-sm font-medium">{theme.label}</span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-3 rounded-full border border-white/20"
                          style={{ backgroundColor: theme.accentTintHex }}
                        />
                        <span
                          className="h-3 w-3 rounded-full border border-white/20"
                          style={{ backgroundColor: theme.accentSoftHex }}
                        />
                        <span
                          className="h-3 w-3 rounded-full border border-white/20"
                          style={{ backgroundColor: theme.accentHex }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-lg font-semibold text-foreground">Charts</h3>
            <p className="mt-2 text-sm text-muted">
              Limit how many samples are rendered at once in Activity Detail charts. Zooming in
              will load more detail within the visible range up to this cap.
            </p>
            <div className="mt-4 rounded-lg border border-border bg-bg/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="chart-max-samples" className="text-sm font-medium text-foreground">
                  Max visible chart samples
                </label>
                <span className="text-sm font-semibold text-foreground">
                  {(settings?.chartMaxSamples ?? 2000).toLocaleString()}
                </span>
              </div>
              <input
                id="chart-max-samples"
                type="range"
                min={250}
                max={5000}
                step={250}
                value={settings?.chartMaxSamples ?? 2000}
                onChange={(event) => void updateChartMaxSamples(Number(event.target.value))}
                className="mt-3 w-full accent-[rgb(var(--color-accent))]"
              />
              <p className="mt-2 text-xs text-muted">
                Lower values improve responsiveness on slower machines. Higher values reveal more
                detail before zooming.
              </p>
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={settings?.chartOutlierRemoval ?? true}
                onChange={(event) => void updateChartOutlierRemoval(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border bg-bg"
              />
              <span>
                Remove chart outliers
                <span className="mt-1 block text-xs text-muted">
                  Uses a robust local filter to hide suspicious spikes from pace, speed, heart
                  rate, cadence, power, and elevation plots.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-lg font-semibold text-foreground">Heatmap</h3>
            <p className="mt-2 text-sm text-muted">
              Control how route overlays render on the Heatmap page.
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={settings?.heatmapFullOpacity ?? false}
                onChange={(event) => void updateHeatmapFullOpacity(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border bg-bg"
              />
              <span>
                Use 100% opacity for heatmap routes
                <span className="mt-1 block text-xs text-muted">
                  Disables the adaptive transparent styling and renders route lines fully opaque.
                </span>
              </span>
            </label>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-lg font-semibold text-foreground">Heart Rate Zones</h3>
          <p className="mt-2 text-sm text-muted">
            Configure your personal zone cutoffs in bpm. Z5 is automatically anything above your
            Z4 upper bound.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Zone
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Range
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Upper bound (bpm)
            </div>

            {['Z1', 'Z2', 'Z3', 'Z4'].map((zoneLabel, index) => {
              const previousBound = index === 0 ? 0 : previewHeartRateBounds[index - 1];
              const currentDraft = heartRateZoneDraft[index] ?? '';
              const currentBound = previewHeartRateBounds[index];
              const rangeLabel =
                index === 0
                  ? `≤ ${Math.max(1, currentBound)} bpm`
                  : `${previousBound + 1}-${Math.max(previousBound + 1, currentBound)} bpm`;

              return (
                <div key={zoneLabel} className="contents">
                  <div className="flex items-center text-sm font-medium text-foreground">{zoneLabel}</div>
                  <div className="flex items-center text-sm text-muted">{rangeLabel}</div>
                  <input
                    type="number"
                    min={40}
                    max={260}
                    step={1}
                    inputMode="numeric"
                    value={currentDraft}
                    onChange={(event) => {
                      setHeartRateZoneDraft((current) =>
                        current.map((value, valueIndex) =>
                          valueIndex === index ? event.target.value : value
                        )
                      );
                      setHeartRateZoneDirty(true);
                    }}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-foreground"
                  />
                </div>
              );
            })}

            <div className="flex items-center text-sm font-medium text-foreground">Z5</div>
            <div className="flex items-center text-sm text-muted">
              ≥ {previewHeartRateBounds[3] + 1} bpm
            </div>
            <div className="flex items-center text-sm text-muted">Auto-derived</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSaveHeartRateZones()}
              disabled={!heartRateZoneDirty}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save Zones
            </button>
            <button
              type="button"
              onClick={() => {
                setHeartRateZoneDraft(savedHeartRateBounds.map((value) => String(value)));
                setHeartRateZoneDirty(false);
                setError(null);
              }}
              disabled={!heartRateZoneDirty}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted disabled:opacity-50"
            >
              Reset
            </button>
          </div>

          <p className="mt-3 text-xs text-muted">
            These zones are used on Activity Detail pages to calculate time spent in each zone from
            recorded heart-rate samples.
          </p>
        </section>
      )}
    </div>
  );
}
