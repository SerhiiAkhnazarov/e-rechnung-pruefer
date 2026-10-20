#!/bin/sh
# build-oracle-xsl.sh — compiles the Peppol BIS Billing 3.0 and the Factur-X / ZUGFeRD (ZF_250)
# Schematron sources with the ISO Schematron XSLT2 skeleton (phax/ph-schematron, 20100710-xslt2:
# iso_dsdl_include -> iso_abstract_expand -> iso_svrl_for_xslt2) exactly as
# test/kosit-reference/build-xrechnung-xsl.sh does for XRechnung. The resulting XSLTs are the Saxon
# reference for test/run-oracle.sh / test/compare-oracle.cjs.
#
# The Factur-X rules call document('FACTUR-X_<PROFILE>_codedb.xml'); XSLT resolves that relative
# URI against the base URI of the stylesheet, so the code-list files are copied next to the compiled
# XSLT: the lookup then resolves exactly as it does next to the original .sch file.
#
# Usage: sh test/build-oracle-xsl.sh <out-dir>
#   writes PEPPOL-UBL-validation.xsl, PEPPOL-CII-validation.xsl, FACTUR-X-<PROFILE>-validation.xsl
#   (+ FACTUR-X_<PROFILE>_codedb.xml) and a step1/step2 .sch per source under <out-dir>/tmp-sch/
# Environment: SAXON_JAR, PEPPOL_DIR, MUSTANG_DIR, PH_SCHEMATRON_DIR
set -e
OUT="${1:?out dir}"
# repositories and tools in the CI layout under build/ext (tools/verify-all.cjs links them); every path can be overridden
EXT="${EXT_DIR:-$(cd "$(dirname "$0")" && cd "$(git rev-parse --show-toplevel 2>/dev/null || echo ../..)" && pwd)/build/ext}"
SAXON_JAR="${SAXON_JAR:-$EXT/saxon/saxon-he-12.8.jar}"
PEPPOL_DIR="${PEPPOL_DIR:-$EXT/peppol-bis-invoice-3}"
MUSTANG_DIR="${MUSTANG_DIR:-$EXT/mustangproject}"
PH_SCHEMATRON_DIR="${PH_SCHEMATRON_DIR:-$EXT/ph-schematron}"
SK="$PH_SCHEMATRON_DIR/ph-schematron-isosch/src/main/resources/external/schematron/20100710-xslt2"
ZF="$MUSTANG_DIR/validator/src/main/resources/schematron/ZF_250"
for f in "$SAXON_JAR" "$SK/iso_svrl_for_xslt2.xsl" "$PEPPOL_DIR/rules/sch/PEPPOL-EN16931-UBL.sch" "$ZF/FACTUR-X_EN16931.sch"; do
  [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
done
SAXON_LIB="$(dirname "$SAXON_JAR")/lib"
CP="$SAXON_JAR"
[ -d "$SAXON_LIB" ] && CP="$CP:$SAXON_LIB/*"
TMP="$OUT/tmp-sch"
mkdir -p "$OUT" "$TMP"
saxon() { java -cp "$CP" net.sf.saxon.Transform "$@" 2>&1 | grep -v 'JAVA_TOOL_OPTIONS' || true; }
compile() { # <name> <source.sch>
  name="$1"; src="$2"
  saxon -s:"$src" -xsl:"$SK/iso_dsdl_include.xsl" -o:"$TMP/$name-step1.sch"
  saxon -s:"$TMP/$name-step1.sch" -xsl:"$SK/iso_abstract_expand.xsl" -o:"$TMP/$name-step2.sch"
  saxon -s:"$TMP/$name-step2.sch" -xsl:"$SK/iso_svrl_for_xslt2.xsl" -o:"$OUT/$name-validation.xsl" allow-foreign=true full-path-notation=4
  [ -s "$OUT/$name-validation.xsl" ] || { echo "skeleton compilation failed for $name" >&2; exit 1; }
  echo "built $OUT/$name-validation.xsl (sha256 $(sha256sum "$OUT/$name-validation.xsl" | cut -c1-16)…) from $src"
}
compile PEPPOL-UBL "$PEPPOL_DIR/rules/sch/PEPPOL-EN16931-UBL.sch"
compile PEPPOL-CII "$PEPPOL_DIR/rules/sch/PEPPOL-EN16931-CII.sch"
for P in MINIMUM BASIC-WL BASIC EN16931 EXTENDED; do
  cp "$ZF/FACTUR-X_${P}_codedb.xml" "$OUT/"
  compile "FACTUR-X-$P" "$ZF/FACTUR-X_$P.sch"
done
