#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]] || ! command -v apt-get >/dev/null 2>&1; then
  echo "This helper supports Ubuntu 22.04+ and Debian 12+ (apt). See README.md for other Linux distributions." >&2
  exit 1
fi

sudo_cmd=()
if [[ "$EUID" -ne 0 ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Run this helper as root or install sudo first." >&2
    exit 1
  fi
  sudo_cmd=(sudo)
fi

# Tauri's native prerequisites plus the tools used to create .deb/AppImage bundles.
"${sudo_cmd[@]}" apt-get update
"${sudo_cmd[@]}" apt-get install -y \
  build-essential \
  pkg-config \
  curl \
  wget \
  file \
  ca-certificates \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libssl-dev \
  libxdo-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
