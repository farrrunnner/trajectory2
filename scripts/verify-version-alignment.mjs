import { readFileSync } from 'node:fs';

// Resolve from this file so this also works outside the repository root, on every OS.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

try {
  if (process.argv.length > 3) {
    throw new Error('Usage: node scripts/verify-version-alignment.mjs [version-or-tag]');
  }

  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const cargo = read('src-tauri/Cargo.toml').split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoLock = read('src-tauri/Cargo.lock').split(/^\[\[package\]\]\s*$/m)
    .find((section) => /^name = "trajectory"\s*$/m.test(section));
  const version = (section) => section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const expected = (process.argv[2] || process.env.EXPECTED_VERSION || pkg.version).replace(/^v/, '');
  const versions = {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json (root package)': lock.packages?.['']?.version,
    'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
    'src-tauri/Cargo.toml': version(cargo),
    'src-tauri/Cargo.lock (trajectory)': version(cargoLock)
  };

  if (Object.values(versions).some((value) => value !== expected)) {
    throw new Error(`Version mismatch. Expected ${expected}.\n${Object.entries(versions)
      .map(([file, value]) => `  ${file}: ${value ?? 'missing'}`).join('\n')}`);
  }
  console.log(`Version alignment OK: ${expected}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
