#!/bin/sh
# merge-xrechnung-sch.sh — the KoSIT build step "merge-peppol-rules-with-xr-rules" of xrechnung-schematron
# (docs/BUILD-RULES.md §1): integrates the whitelisted Peppol BIS rules (src/xsl/rule-list.xml) into the
# XRechnung Schematron with the repository's own src/xsl/peppol-into-xr.xsl. The result is what the KoSIT
# validator configuration ships and what build/schemas/XRechnung-*.json is compiled from; its SHA-256 is
# recorded in build/STANDARDS_MANIFEST.json (xrechnung-schematron "merged") and checked by
# tools/check-reproducible.cjs.
#
# Usage: sh tools/merge-xrechnung-sch.sh <ext-dir> [<out-dir>]
#   <out-dir> default: <ext-dir>/xrechnung-schematron/build/schematron (the layout the KoSIT build produces)
# Environment: SAXON_JAR (default <ext-dir>/saxon/saxon-he-12.8.jar), XR_VERSION (3.0.2), XR_SCH_VERSION (2.6.0)
set -e
EXT="${1:?usage: merge-xrechnung-sch.sh <ext-dir> [<out-dir>]}"
XR="$EXT/xrechnung-schematron"
OUT="${2:-$XR/build/schematron}"
SAXON_JAR="${SAXON_JAR:-$EXT/saxon/saxon-he-12.8.jar}"
XR_VERSION="${XR_VERSION:-3.0.2}"
XR_SCH_VERSION="${XR_SCH_VERSION:-2.6.0}"
CP="$SAXON_JAR"; [ -d "$(dirname "$SAXON_JAR")/lib" ] && CP="$CP:$(dirname "$SAXON_JAR")/lib/*"
# peppol-into-xr.xsl reads ../../build/bis/PEPPOL-EN16931-*.sch relative to the stylesheet (src/xsl/)
mkdir -p "$OUT/tmp" "$OUT/ubl" "$OUT/cii" "$XR/build/bis"
cp "$EXT/peppol-bis-invoice-3/rules/sch/PEPPOL-EN16931-UBL.sch" "$EXT/peppol-bis-invoice-3/rules/sch/PEPPOL-EN16931-CII.sch" "$XR/build/bis/"
cp "$XR/src/validation/schematron/common.sch" "$OUT/"
for s in ubl cii; do
  U=$(echo "$s" | tr a-z A-Z)
  sed -e "s/@xr-schematron.version.full@/$XR_SCH_VERSION/g" -e "s/@xrechnung.version@/$XR_VERSION/g" \
    "$XR/src/validation/schematron/$s/XRechnung-$U-validation.sch" > "$OUT/tmp/XRechnung-$U-validation.sch"
  java -cp "$CP" net.sf.saxon.Transform -s:"$OUT/tmp/XRechnung-$U-validation.sch" -xsl:"$XR/src/xsl/peppol-into-xr.xsl" \
    -o:"$OUT/$s/XRechnung-$U-validation.sch" syntax=$U
done
rm -rf "$OUT/tmp"
sha256sum "$OUT/ubl/XRechnung-UBL-validation.sch" "$OUT/cii/XRechnung-CII-validation.sch" "$OUT/common.sch"
