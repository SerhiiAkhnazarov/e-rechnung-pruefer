#!/bin/sh
# run.sh — reference run: Saxon HE 12.8 executes the official KoSIT visualization stylesheets (xrechnung-visualization,
# src/xsl/ubl-invoice-xr.xsl, ubl-creditnote-xr.xsl, cii-xr.xsl) over the corpus. Each output is the KoSIT
# semantic-model instance (xr:invoice) of one document: every business group and business term with its EN 16931
# identifier (xr:id, e.g. BT-27) and the path of the source element (xr:src). Consumers:
#   tools/build-bt-paths.cjs       — the syntax binding element path -> BT/BG (build/bt-paths.json)
#   test/run-invoice-model-tests.cjs — the values of src/invoice-model.js against these instances
#
# Usage: sh test/kosit-visualization/run.sh <saxon-dir> <xrechnung-visualization-dir> [--dirs d1,d2]
# Output: build/oracle/xr/<corpus dir>/<ubl-invoice|ubl-creditnote|cii>/<file>
set -e
SAXON_DIR="$1"; XRV="$2"; shift 2
DIRS="xr-ubl,cen-ubl,extra-ubl,peppol-ubl,zugferd-ubl,xr-cii,cen-cii,extra-cii,peppol-cii,zugferd-cii"
while [ $# -gt 0 ]; do
  case "$1" in
    --dirs) DIRS="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
CP="$SAXON_DIR/saxon-he-12.8.jar:$SAXON_DIR/lib/*"
CORPUS="$HERE/build/corpus"
OUT="$HERE/build/oracle/xr"
rm -rf "$OUT"
mkdir -p "$OUT"
run() { # dir name xsl
  [ -d "$CORPUS/$1" ] || { echo "skip: no corpus directory $CORPUS/$1"; return 0; }
  mkdir -p "$OUT/$1/$2"
  # a stylesheet applied to a document of the other root element (Invoice / CreditNote) yields no xr:invoice;
  # dynamic errors of single documents are logged and do not stop the run (-quit:off)
  java -cp "$CP" net.sf.saxon.Transform -s:"$CORPUS/$1" -o:"$OUT/$1/$2" -xsl:"$3" -quit:off 2>&1 | grep -v JAVA_TOOL_OPTIONS > "$OUT/$1/$2.log" || true
  echo "  $1 x $2: $(grep -l '<xr:invoice' "$OUT/$1/$2"/* 2>/dev/null | wc -l) xr:invoice instances of $(ls "$CORPUS/$1" | wc -l) documents"
}
has() { case ",$DIRS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
for d in xr-ubl cen-ubl extra-ubl peppol-ubl zugferd-ubl; do
  has "$d" || continue
  run "$d" ubl-invoice "$XRV/src/xsl/ubl-invoice-xr.xsl"
  run "$d" ubl-creditnote "$XRV/src/xsl/ubl-creditnote-xr.xsl"
done
for d in xr-cii cen-cii extra-cii peppol-cii zugferd-cii; do
  has "$d" || continue
  run "$d" cii "$XRV/src/xsl/cii-xr.xsl"
done
echo "KoSIT visualization instances: $(grep -rl '<xr:invoice' "$OUT" --include='*' 2>/dev/null | wc -l) (build/oracle/xr)"
