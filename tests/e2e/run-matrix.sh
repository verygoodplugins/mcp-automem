#!/usr/bin/env bash
# Repeatable entrypoint for the AutoMem installer e2e matrix.
#
# Lives at <installer-repo>/tests/e2e/. Derives the repo root from its own location,
# builds+packs a fresh tarball, and runs the co-located harness in throwaway sandboxes
# (fresh $HOME + cwd per scenario) so it never touches the operator's real ~/.codex,
# ~/.claude, ~/.config/automem, or the dev project's containers.
#
# Steps:
#   1. (unless SKIP_BUILD=1) build the installer and pack a fresh tarball into the
#      scratch dir. build-before-pack is mandatory: `prepare` is husky, NOT a build,
#      so packing without `npm run build` ships stale dist/.
#   2. run the Node scenario matrix.
#
# Env overrides:
#   AUTOMEM_REPO_ROOT    installer repo (default: two levels up from this script)
#   AUTOMEM_E2E_SCRATCH  scratch root, OUTSIDE the repo (default: /tmp/automem-installer-harness)
#   AUTOMEM_INSTALL_SH   sibling website install.sh (harness skips that scenario if absent)
#
# Usage:
#   ./run-matrix.sh                 # build + pack + run all scenarios
#   SKIP_BUILD=1 ./run-matrix.sh    # reuse the staged tarball (fast iteration)
#   ./run-matrix.sh dry-run         # filter scenarios by name substring
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${AUTOMEM_REPO_ROOT:-$(cd "$HERE/../.." && pwd)}"
HARNESS_DIR="${AUTOMEM_E2E_SCRATCH:-/tmp/automem-installer-harness}"
TARBALL="$HARNESS_DIR/automem-local.tgz"

# Keep the harness and this script in agreement on both paths.
export AUTOMEM_REPO_ROOT="$REPO"
export AUTOMEM_E2E_SCRATCH="$HARNESS_DIR"

mkdir -p "$HARNESS_DIR"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "=== build + pack (from $REPO) ==="
  (
    cd "$REPO"
    npm run build
    PACKED="$(npm pack --silent | tail -1)"
    echo "packed: $PACKED"
    mv -f "$PACKED" "$TARBALL"
  )
  echo "staged tarball -> $TARBALL"
else
  echo "=== SKIP_BUILD=1: reusing $TARBALL ==="
  [ -f "$TARBALL" ] || { echo "FATAL: $TARBALL missing; run without SKIP_BUILD first"; exit 2; }
fi

echo "=== running scenario matrix ==="
node "$HERE/harness.mjs" "${1:-}"
