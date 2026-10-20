#!/bin/sh
# build-xrechnung-xsl.sh — reproduces the XRechnung Schematron XSLT compilation that the KoSIT
# configuration expects under resources/xrechnung/<version>/xsl/ (docs/BUILD-RULES.md §2 and §4):
#   1. xrechnung-schematron build step "merge-peppol-rules-with-xr-rules" (peppol-into-xr.xsl)
#   2. ISO Schematron XSLT2 skeleton (ph-schematron, 20100710-xslt2): include -> abstract -> svrl
# The official release compiles the merged Schematron with SchXslt 1.10.1 instead (see
# docs/KOSIT-REFERENCE.md, section "Abweichungen"); SchXslt is not reachable from the sandbox.
#
# Usage: sh build-xrechnung-xsl.sh <out-dir>   (writes XRechnung-UBL-validation.xsl / XRechnung-CII-validation.xsl)
# Environment: SAXON_JAR, XR_SCHEMATRON_DIR, PEPPOL_DIR, PH_SCHEMATRON_DIR, XR_VERSION (3.0.2), XR_SCH_VERSION (2.6.0)
set -e
OUT="${1:?out dir}"
# repositories and tools in the CI layout under build/ext (tools/verify-all.cjs links them); every path can be overridden
EXT="${EXT_DIR:-$(cd "$(dirname "$0")" && cd "$(git rev-parse --show-toplevel 2>/dev/null || echo ../..)" && pwd)/build/ext}"
SAXON_JAR="${SAXON_JAR:-$EXT/saxon/saxon-he-12.8.jar}"
XR_SCHEMATRON_DIR="${XR_SCHEMATRON_DIR:-$EXT/xrechnung-schematron}"
PEPPOL_DIR="${PEPPOL_DIR:-$EXT/peppol-bis-invoice-3}"
PH_SCHEMATRON_DIR="${PH_SCHEMATRON_DIR:-$EXT/ph-schematron}"
XR_VERSION="${XR_VERSION:-3.0.2}"
XR_SCH_VERSION="${XR_SCH_VERSION:-2.6.0}"
SK="$PH_SCHEMATRON_DIR/ph-schematron-isosch/src/main/resources/external/schematron/20100710-xslt2"
for f in "$SAXON_JAR" "$SK/iso_svrl_for_xslt2.xsl" "$XR_SCHEMATRON_DIR/src/xsl/peppol-into-xr.xsl" "$PEPPOL_DIR/rules/sch/PEPPOL-EN16931-UBL.sch"; do
  [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
done
SAXON_LIB="$(dirname "$SAXON_JAR")/lib"
CP="$SAXON_JAR"
[ -d "$SAXON_LIB" ] && CP="$CP:$SAXON_LIB/*"
TMP="$OUT/tmp-sch"
mkdir -p "$OUT" "$TMP/tmp" "$TMP/ubl" "$TMP/cii" "$TMP/bis"
cp "$XR_SCHEMATRON_DIR/src/validation/schematron/common.sch" "$TMP/"
cp "$PEPPOL_DIR/rules/sch/PEPPOL-EN16931-UBL.sch" "$PEPPOL_DIR/rules/sch/PEPPOL-EN16931-CII.sch" "$TMP/bis/"
for s in ubl cii; do
  U=$(echo "$s" | tr a-z A-Z)
  sed -e "s/@xr-schematron.version.full@/$XR_SCH_VERSION/g" -e "s/@xrechnung.version@/$XR_VERSION/g" \
    "$XR_SCHEMATRON_DIR/src/validation/schematron/$s/XRechnung-$U-validation.sch" > "$TMP/tmp/XRechnung-$U-validation.sch"
  # peppol-into-xr.xsl resolves ../bis/ and ../common.sch relative to the source document
  java -cp "$CP" net.sf.saxon.Transform -s:"$TMP/tmp/XRechnung-$U-validation.sch" -xsl:"$XR_SCHEMATRON_DIR/src/xsl/peppol-into-xr.xsl" \
    -o:"$TMP/$s/XRechnung-$U-validation.sch" syntax=$U 2>&1 | grep -v 'JAVA_TOOL_OPTIONS' || true
  [ -s "$TMP/$s/XRechnung-$U-validation.sch" ] || { echo "merge failed for $U" >&2; exit 1; }
  java -cp "$CP" net.sf.saxon.Transform -s:"$TMP/$s/XRechnung-$U-validation.sch" -xsl:"$SK/iso_dsdl_include.xsl" -o:"$TMP/$s/step1.sch" 2>&1 | grep -v 'JAVA_TOOL_OPTIONS' || true
  java -cp "$CP" net.sf.saxon.Transform -s:"$TMP/$s/step1.sch" -xsl:"$SK/iso_abstract_expand.xsl" -o:"$TMP/$s/step2.sch" 2>&1 | grep -v 'JAVA_TOOL_OPTIONS' || true
  java -cp "$CP" net.sf.saxon.Transform -s:"$TMP/$s/step2.sch" -xsl:"$SK/iso_svrl_for_xslt2.xsl" -o:"$OUT/XRechnung-$U-validation.xsl" allow-foreign=true full-path-notation=4 2>&1 | grep -v 'JAVA_TOOL_OPTIONS' || true
  [ -s "$OUT/XRechnung-$U-validation.xsl" ] || { echo "skeleton compilation failed for $U" >&2; exit 1; }
  echo "built $OUT/XRechnung-$U-validation.xsl (sha256 $(sha256sum "$OUT/XRechnung-$U-validation.xsl" | cut -c1-16)…)"
done
