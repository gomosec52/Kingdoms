#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>" >&2
  echo "Example: $0 1.12.41" >&2
  exit 1
fi

OUTPUT="$ROOT/KW-Build-v${VERSION}.mcaddon"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp -a "$ROOT/behavior_pack" "$TMP_DIR/behavior_pack"
cp -a "$ROOT/resource_pack" "$TMP_DIR/resource_pack"

(
  cd "$TMP_DIR"
  zip -qr "$OUTPUT" behavior_pack resource_pack
)

echo "Built $OUTPUT"
