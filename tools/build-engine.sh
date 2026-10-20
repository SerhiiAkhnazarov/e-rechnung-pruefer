#!/bin/sh
# build-engine.sh — regenerates patches/fontoxpath-pruefer.patch from a fontoxpath working checkout and
# rebuilds the bundles in vendor/ from upstream + that patch in a clean temporary layout
# (tools/check-engine.sh --update, which needs <ext-dir> with the dependency clones).
#
# Usage: sh tools/build-engine.sh <fontoxpath-checkout> <ext-dir> [esbuild-binary]
#   The checkout must be upstream commit 7506ae0cd03dab66f49091ad5a9690eee3b33ce5 (fontoxpath 3.34.0)
#   with the Prüfer patch applied (git apply patches/fontoxpath-pruefer.patch).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
FX="$1"; EXT="${2:?ext dir}"; ESB="${3:-${ESBUILD_BINARY:-esbuild}}"
[ -d "$FX/src" ] || { echo "usage: build-engine.sh <fontoxpath-checkout> <ext-dir> [esbuild]" >&2; exit 2; }
BASE=7506ae0cd03dab66f49091ad5a9690eee3b33ce5
[ "$(git -C "$FX" rev-parse HEAD)" = "$BASE" ] || { echo "checkout is not at $BASE" >&2; exit 2; }
# patch = all changes of the checkout against the upstream commit, new files included
git -C "$FX" add -N src
git -C "$FX" diff "$BASE" -- src > "$HERE/patches/fontoxpath-pruefer.patch"
echo "patch: $(grep -c "^diff --git" "$HERE/patches/fontoxpath-pruefer.patch") files, $(wc -l < "$HERE/patches/fontoxpath-pruefer.patch") lines"
sh "$HERE/tools/check-engine.sh" --update "$EXT" "$ESB"
