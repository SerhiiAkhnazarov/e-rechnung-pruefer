#!/bin/sh
# run-facturx-xsd-oracle.sh — Xerces reference (test/xsd-oracle/XsdOracle.java, --schema mode) for the
# five Factur-X / ZUGFeRD ZF_250 profile schemas: every CII document of the corpus is validated against
# each profile XSD; one JSON line per document in build/oracle/xsd-facturx/FACTUR-X-<PROFILE>.jsonl.
#
# Usage: sh test/xsd-oracle/run-facturx-xsd-oracle.sh
# Environment: ZF_XSD_DIR (default: Mustangproject validator/src/main/resources/schema/ZF_250)
set -e
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
# repositories and tools in the CI layout under build/ext (tools/verify-all.cjs links them); every path can be overridden
EXT="${EXT_DIR:-$(cd "$(dirname "$0")" && cd "$(git rev-parse --show-toplevel 2>/dev/null || echo ../..)" && pwd)/build/ext}"
ZF_XSD_DIR="${ZF_XSD_DIR:-$EXT/mustangproject/validator/src/main/resources/schema/ZF_250}"
OUT="$HERE/build/oracle/xsd-facturx"
mkdir -p "$OUT"
javac -d "$HERE/test/xsd-oracle" "$HERE/test/xsd-oracle/XsdOracle.java"
for P in MINIMUM BASIC-WL BASIC EN16931 EXTENDED; do
  F=$(echo "$P" | tr -d '-')
  echo "Xerces: FACTUR-X-$P ($ZF_XSD_DIR/$P/FACTUR-X_$F.xsd)"
  java -cp "$HERE/test/xsd-oracle" XsdOracle --schema "$ZF_XSD_DIR/$P/FACTUR-X_$F.xsd" "$OUT/FACTUR-X-$P.jsonl" \
    "$HERE/build/corpus/xr-cii" "$HERE/build/corpus/cen-cii" "$HERE/build/corpus/extra-cii" \
    "$HERE/build/corpus/peppol-cii" "$HERE/build/corpus/zugferd-cii" 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
done
echo "oracle output in $OUT"
