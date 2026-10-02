import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { useAppStore } from '@/store/useAppStore';

export function OnboardingPage() {
  const updateImportFolder = useAppStore((state) => state.updateImportFolder);
  const [recursive, setRecursive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleChooseFolder = async () => {
    setError(null);
    const result = await open({ directory: true, multiple: false, title: 'Select Import Folder' });
    if (!result || Array.isArray(result)) {
      return;
    }

    try {
      setSaving(true);
      await updateImportFolder(result, recursive);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-foreground">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-panel p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">First Launch</p>
        <h1 className="mt-2 text-3xl font-semibold">Select Import Folder</h1>
        <p className="mt-3 text-sm text-muted">
          Choose the existing folder containing your .tcx or .fit files. The app will never
          modify these files and will start scanning automatically in the background once selected.
        </p>

        <label className="mt-6 flex items-center gap-3 text-sm text-muted">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(event) => setRecursive(event.target.checked)}
            className="h-4 w-4 rounded border-border bg-bg"
          />
          Scan subfolders recursively
        </label>

        <button
          type="button"
          onClick={handleChooseFolder}
          disabled={saving}
          className="mt-6 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Choose Folder'}
        </button>

        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </section>
    </main>
  );
}
