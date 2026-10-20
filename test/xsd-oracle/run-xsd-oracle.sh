#!/bin/sh
# run-xsd-oracle.sh — compiles and runs the Xerces reference (test/xsd-oracle/XsdOracle.java) over
# the corpora and writes build/oracle/xsd/<name>.jsonl (one JSON line per document).
#
# Usage: sh test/xsd-oracle/run-xsd-oracle.sh [<name> <dir-or-file>...]
#   without arguments: the standard corpora (build/corpus/*, the ZUGFeRD corpus, the generated
#   XSD mutations) are run one after the other.
#
# Environment (defaults = the locations used for the recorded reference run):
#   UBL_XSD_DIR  directory holding maindoc/ and common/ of OASIS os-UBL-2.1 (xsdrt variant)
#   CII_XSD_DIR  directory holding CrossIndustryInvoice_100pD16B.xsd (+ its 3 imports)
#   ZUGFERD_CORPUS  directory with the ZUGFeRD/Factur-X example XMLs
set -e
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
# repositories and tools in the CI layout under build/ext (tools/verify-all.cjs links them); every path can be overridden
EXT="${EXT_DIR:-$(cd "$(dirname "$0")" && cd "$(git rev-parse --show-toplevel 2>/dev/null || echo ../..)" && pwd)/build/ext}"
UBL_XSD_DIR="${UBL_XSD_DIR:-$EXT/os-UBL-2.1/xsdrt}"
CII_XSD_DIR="${CII_XSD_DIR:-$EXT/ph-cii/ph-cii-d16b/src/main/resources/external/schemas/d16b/data/standard}"
ZUGFERD_CORPUS="${ZUGFERD_CORPUS:-$EXT/zugferd-corpus}"
OUT="$HERE/build/oracle/xsd"
mkdir -p "$OUT"
javac -d "$HERE/test/xsd-oracle" "$HERE/test/xsd-oracle/XsdOracle.java"
run() { # name dirs...
  name="$1"; shift
  echo "Xerces: $name"
  java -cp "$HERE/test/xsd-oracle" XsdOracle \
    "$UBL_XSD_DIR/maindoc/UBL-Invoice-2.1.xsd" \
    "$UBL_XSD_DIR/maindoc/UBL-CreditNote-2.1.xsd" \
    "$CII_XSD_DIR/CrossIndustryInvoice_100pD16B.xsd" \
    "$OUT/$name.jsonl" "$@" 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
}
if [ $# -gt 0 ]; then
  run "$@"
  exit 0
fi
for d in xr-ubl xr-cii cen-ubl cen-cii extra-ubl extra-cii; do
  run "$d" "$HERE/build/corpus/$d"
done
run zugferd "$ZUGFERD_CORPUS"
if [ -d "$HERE/build/corpus/xsd-mutations" ]; then
  run xsd-mutations "$HERE/build/corpus/xsd-mutations"
fi
echo "oracle output in $OUT"
