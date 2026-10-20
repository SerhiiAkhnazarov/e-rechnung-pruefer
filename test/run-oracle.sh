#!/bin/sh
# run-oracle.sh — reference run: Saxon HE 12.8 executes the official XSLT compilations of the
# Schematron rules over the whole corpus and stores SVRL (build/oracle/<dir>/<schema>/<file>):
#   EN16931-*     CEN XSLT from the CEN repository (ubl/xslt, cii/xslt)
#   XRechnung-*   compiled from the merged KoSIT Schematron with the ISO Schematron XSLT2 skeleton
#                 (test/kosit-reference/build-xrechnung-xsl.sh)
#   PEPPOL-*      full Peppol BIS Billing 3.0 rules, ISO skeleton (test/build-oracle-xsl.sh)
#   FACTUR-X-*    Factur-X / ZUGFeRD ZF_250 profiles MINIMUM, BASIC-WL, BASIC, EN16931, EXTENDED,
#                 ISO skeleton (test/build-oracle-xsl.sh; the codedb files lie next to the XSLT)
#
# Usage: sh test/run-oracle.sh <saxon-dir> <cen-repo> <oracle-xsl-dir> [--sets A,B,...] [--dirs d1,d2] [--keep]
#   --sets   families to run (default: EN16931,XRechnung,PEPPOL,FACTUR-X)
#   --dirs   corpus directories to run (default: all of xr-ubl cen-ubl extra-ubl peppol-ubl zugferd-ubl
#            xr-cii cen-cii extra-cii peppol-cii zugferd-cii)
#   --keep   do not delete build/oracle first (results of other families/directories are kept)
set -e
SAXON_DIR="$1"; CEN="$2"; ORACLE="$3"; shift 3
SETS="EN16931,XRechnung,PEPPOL,FACTUR-X"; DIRS="xr-ubl,cen-ubl,extra-ubl,peppol-ubl,zugferd-ubl,xr-cii,cen-cii,extra-cii,peppol-cii,zugferd-cii"; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sets) SETS="$2"; shift 2 ;;
    --dirs) DIRS="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CP="$SAXON_DIR/saxon-he-12.8.jar:$SAXON_DIR/lib/*"
CORPUS="$HERE/build/corpus"
OUT="$HERE/build/oracle"
[ "$KEEP" = 1 ] || rm -rf "$OUT"
mkdir -p "$OUT"
has() { case ",$SETS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
hasdir() { case ",$DIRS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
run() { # dir schemaName xsl
  hasdir "$1" || return 0
  [ -d "$CORPUS/$1" ] || { echo "skip: no corpus directory $CORPUS/$1"; return 0; }
  rm -rf "$OUT/$1/$2" "$OUT/$1/$2.log" "$OUT/$1/$2.failed"
  mkdir -p "$OUT/$1/$2"
  echo "Saxon: $1 x $2"
  t0=$(date +%s)
  java -cp "$CP" net.sf.saxon.Transform -s:"$CORPUS/$1" -o:"$OUT/$1/$2" -xsl:"$3" -quit:off 2>&1 | grep -v JAVA_TOOL_OPTIONS > "$OUT/$1/$2.log" || true
  grep -oE 'While processing [^:]+:' "$OUT/$1/$2.log" | sed -E 's/While processing (.*):/\1/' | sort -u > "$OUT/$1/$2.failed"
  echo "  $(ls "$OUT/$1/$2" | wc -l) SVRL files, failed transformations (dynamic errors): $(wc -l < "$OUT/$1/$2.failed"), $(( $(date +%s) - t0 )) s"
}
for d in xr-ubl cen-ubl extra-ubl peppol-ubl zugferd-ubl; do
  has EN16931 && run "$d" EN16931-UBL "$CEN/ubl/xslt/EN16931-UBL-validation.xslt"
  has XRechnung && run "$d" XRechnung-UBL "$ORACLE/XRechnung-UBL-validation.xsl"
  has PEPPOL && run "$d" PEPPOL-UBL "$ORACLE/PEPPOL-UBL-validation.xsl"
done
for d in xr-cii cen-cii extra-cii peppol-cii zugferd-cii; do
  has EN16931 && run "$d" EN16931-CII "$CEN/cii/xslt/EN16931-CII-validation.xslt"
  has XRechnung && run "$d" XRechnung-CII "$ORACLE/XRechnung-CII-validation.xsl"
  has PEPPOL && run "$d" PEPPOL-CII "$ORACLE/PEPPOL-CII-validation.xsl"
  if has FACTUR-X; then
    for P in MINIMUM BASIC-WL BASIC EN16931 EXTENDED; do run "$d" "FACTUR-X-$P" "$ORACLE/FACTUR-X-$P-validation.xsl"; done
  fi
done
echo "oracle SVRL written to $OUT"
