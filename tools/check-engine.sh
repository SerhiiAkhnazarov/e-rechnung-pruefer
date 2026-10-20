#!/bin/sh
# check-engine.sh — proves that the shipped XPath engine bundles (vendor/) are exactly
#   upstream fontoxpath 3.34.0 (commit 7506ae0cd03d) + patches/fontoxpath-pruefer.patch,
# built with esbuild against the pinned dependency commits (build/STANDARDS_MANIFEST.json).
# Everything happens in a fresh temporary directory: clean clone, git apply, bundle, byte comparison.
#
#   + patches/xspattern-pruefer.patch (general category Cn = unassigned codepoints, XML Schema 1.0 Part 2 F.1.1)
# Usage: sh tools/check-engine.sh [--update] <ext-dir> [esbuild-binary]
#   --update  copy the rebuilt bundles into vendor/ (used by tools/build-engine.sh after a patch change;
#             the bundles carry source comments relative to this canonical layout, so they are
#             reproducible on any machine)
#   <ext-dir>/{fontoxpath,xspattern.js,whynot.js,prsc.js,slimdom.js} = clones (any commit; the pinned
#   commits are checked out in the temporary copies). xspattern's generated Unicode tables
#   (src/generated/*.json, Unicode 15.0.0) are rebuilt with the repository's own scripts/buildUnicodeDb.ts
#   when the clone does not have them, and must have the SHA-256 recorded below.
# Licence: EUPL-1.2
set -e
UPDATE=; [ "$1" = "--update" ] && { UPDATE=1; shift; }
EXT="${1:?usage: check-engine.sh <ext-dir> [esbuild]}"
ESB="${2:-${ESBUILD_BINARY:-esbuild}}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE=7506ae0cd03dab66f49091ad5a9690eee3b33ce5
MANIFEST="$HERE/build/STANDARDS_MANIFEST.json"
commit_of() { node -e "const m=require(process.argv[1]);for(const s of Object.values(m.sources)){for(const r of (s.repos||[s])){if(r.path===process.argv[2]){console.log(r.commit);process.exit(0)}}}process.exit(1)" "$MANIFEST" "$1"; }
# SHA-256 of the packed tables generated from UCD 15.0.0 (UnicodeData.txt, Blocks.txt)
UNI_BLOCKS=d3689055d500abef4ee962ce11c18b2245f5217e65aa153c8fc1ea482a65a98d
UNI_CATS=d08c726a16ff18c21640f7680f8861730068fdeeae1c35b5c76a4f6739fb5164
T="$(mktemp -d)"
[ -n "$KEEP_TMP" ] && echo "temp: $T" || trap 'rm -rf "$T"' EXIT
git clone -q "$EXT/fontoxpath" "$T/fontoxpath"
git -C "$T/fontoxpath" checkout -q "$BASE"
git -C "$T/fontoxpath" apply "$HERE/patches/fontoxpath-pruefer.patch"
echo "fontoxpath $BASE + patch ($(grep -c '^diff --git' "$HERE/patches/fontoxpath-pruefer.patch") files) applied cleanly"
mkdir -p "$T/node_modules"
for dep in xspattern whynot prsc slimdom; do
  C="$(commit_of "$dep.js")"
  git clone -q "$EXT/$dep.js" "$T/$dep.js"
  git -C "$T/$dep.js" checkout -q "$C"
  # dependency patches (patches/<dep>-pruefer.patch), e.g. xspattern: \p{Cn} for unassigned codepoints
  if [ -f "$HERE/patches/$dep-pruefer.patch" ]; then git -C "$T/$dep.js" apply "$HERE/patches/$dep-pruefer.patch"; echo "$dep.js + patches/$dep-pruefer.patch applied cleanly"; fi
  mkdir -p "$T/node_modules/$dep"
  printf '{"name":"%s","main":"src/index.ts","types":"src/index.ts"}' "$dep" > "$T/node_modules/$dep/package.json"
  ln -s "$T/$dep.js/src" "$T/node_modules/$dep/src"
  echo "$dep.js at $C"
done
mkdir -p "$T/node_modules/fontoxpath"
printf '{"name":"fontoxpath","main":"src/index.ts"}' > "$T/node_modules/fontoxpath/package.json"
ln -s "$T/fontoxpath/src" "$T/node_modules/fontoxpath/src"
# xspattern Unicode tables
mkdir -p "$T/xspattern.js/src/generated"
if [ -f "$EXT/xspattern.js/src/generated/blocks.json" ]; then
  cp "$EXT/xspattern.js/src/generated/"*.json "$T/xspattern.js/src/generated/"
else
  # Unicode Character Database 15.0.0 (the URLs of xspattern's scripts/buildUnicodeDb.ts); when unicode.org is
  # not reachable, the identical UCD files of github.com/unicode-org/unicodetools (data/ucd/15.0.0). The packed
  # result is checked against the SHA-256 below either way.
  mkdir -p "$T/ucd"
  if ! { curl -sSfL -o "$T/ucd/UnicodeData.txt" https://www.unicode.org/Public/15.0.0/ucd/UnicodeData.txt && curl -sSfL -o "$T/ucd/Blocks.txt" https://www.unicode.org/Public/15.0.0/ucd/Blocks.txt; } 2>/dev/null; then
    git clone -q --filter=blob:none --no-checkout --depth 1 https://github.com/unicode-org/unicodetools "$T/unicodetools"
    git -C "$T/unicodetools" sparse-checkout set --no-cone unicodetools/data/ucd/15.0.0/UnicodeData.txt unicodetools/data/ucd/15.0.0/Blocks.txt
    git -C "$T/unicodetools" checkout -q
    cp "$T/unicodetools/unicodetools/data/ucd/15.0.0/UnicodeData.txt" "$T/unicodetools/unicodetools/data/ucd/15.0.0/Blocks.txt" "$T/ucd/"
    echo "UCD 15.0.0 from github.com/unicode-org/unicodetools $(git -C "$T/unicodetools" rev-parse HEAD)"
  fi
  printf '%s\n' "const fs=require('fs'),p=require('path');const {packBlocks,packCategories}=require('./pack.ts');" \
    "fs.writeFileSync(p.join(process.argv[2],'categories.json'),JSON.stringify(packCategories(fs.readFileSync(p.join(process.argv[3],'UnicodeData.txt'),'utf8'))));" \
    "fs.writeFileSync(p.join(process.argv[2],'blocks.json'),JSON.stringify(packBlocks(fs.readFileSync(p.join(process.argv[3],'Blocks.txt'),'utf8'))));" > "$T/xspattern.js/scripts/pack-local.js"
  "$ESB" "$T/xspattern.js/scripts/pack-local.js" --bundle --platform=node --format=cjs --outfile="$T/pack.cjs" --log-level=warning
  node "$T/pack.cjs" "$T/xspattern.js/src/generated" "$T/ucd"
fi
echo "$UNI_BLOCKS  $T/xspattern.js/src/generated/blocks.json" | sha256sum -c -
echo "$UNI_CATS  $T/xspattern.js/src/generated/categories.json" | sha256sum -c -
mkdir -p "$T/vendor"
V='"3.34.0-src-exact"'
# licence notices at the top of every bundle (MIT: "The above copyright notice and this permission notice shall be
# included in all copies or substantial portions"); the full texts are in NOTICE (part E)
FX_BANNER='/*! fontoxpath 3.34.0 (https://github.com/FontoXML/fontoxpath), Copyright (c) 2017 Fonto Group BV, Martin Middel, MIT License; contains xspattern (Copyright (c) 2019 Stef Busking), whynot (Copyright (c) 2017 Stef Busking) and prsc (Copyright (c) 2019 Stef Busking), MIT License, and tables generated from the Unicode Character Database 15.0.0 ((c) 2022 Unicode, Inc., Unicode License V3); esbuild helper code Copyright (c) 2020 Evan Wallace, MIT License. Built from source with patches/fontoxpath-pruefer.patch and patches/xspattern-pruefer.patch by tools/check-engine.sh of https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer, whose NOTICE file contains the full licence texts. */'
SD_BANNER='/*! slimdom 4.3.5 (https://github.com/bwrrp/slimdom.js), Copyright (c) 2017 Stef Busking, MIT License; contains prsc (Copyright (c) 2019 Stef Busking), MIT License; esbuild helper code Copyright (c) 2020 Evan Wallace, MIT License. Built by tools/check-engine.sh of https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer, whose NOTICE file contains the full licence texts. */'
cd "$T"
export NODE_PATH="$T/node_modules"
"$ESB" node_modules/fontoxpath/src/index.ts --bundle --format=cjs --target=es2020 --platform=node --define:VERSION="$V" --banner:js="$FX_BANNER" --outfile=vendor/fontoxpath.cjs --log-level=warning
"$ESB" node_modules/fontoxpath/src/index.ts --bundle --format=iife --global-name=fontoxpath --target=es2020 --platform=browser --define:VERSION="$V" --banner:js="$FX_BANNER" --outfile=vendor/fontoxpath.iife.js --log-level=warning
"$ESB" node_modules/fontoxpath/src/index.ts --bundle --minify --format=iife --global-name=fontoxpath --target=es2020 --platform=browser --define:VERSION="$V" --banner:js="$FX_BANNER" --outfile=vendor/fontoxpath.iife.min.js --log-level=warning
"$ESB" node_modules/slimdom/src/index.ts --bundle --format=cjs --target=es2019 --platform=node --banner:js="$SD_BANNER" --outfile=vendor/slimdom.cjs --log-level=warning
if [ -n "$UPDATE" ]; then cp "$T"/vendor/*.cjs "$T"/vendor/*.js "$HERE/vendor/"; echo "vendor/ updated"; fi
diffs=0
for f in fontoxpath.cjs fontoxpath.iife.js fontoxpath.iife.min.js slimdom.cjs; do
  if cmp -s "$T/vendor/$f" "$HERE/vendor/$f"; then echo "  same     vendor/$f"; else echo "  DIFFERS  vendor/$f"; diffs=$((diffs+1)); fi
done
echo "engine rebuild ($("$ESB" --version 2>/dev/null || echo esbuild)): 4 bundles, $diffs differences"
[ "$diffs" = 0 ]
