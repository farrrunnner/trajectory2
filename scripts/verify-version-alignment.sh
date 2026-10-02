#!/usr/bin/env bash

set -euo pipefail

# Compatibility entry point; npm and CI use the portable Node script directly.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/verify-version-alignment.mjs" "$@"
