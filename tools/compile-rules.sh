#!/bin/sh
# compile-rules.sh — compiles every rule set of the product from the pinned sources (commits in
# build/STANDARDS_MANIFEST.json) with tools/compile-sch.cjs.
#
# Usage: sh tools/compile-rules.sh <ext-dir>
#   <ext-dir> layout as in .github/workflows/verify.yml / tools/verify-all.cjs (build/ext locally):
#   einvoicing-en16931, xrechnung-schematron (with build/schematron/ produced by the KoSIT merge step,
#   docs/BUILD-RULES.md §2), mustangproject, peppol-bis-invoice-3 (optional: the Peppol rule sets are
#   compiled only for the test suites and are not shipped, see docs/RULESETS.md "Lizenz").
set -e
EXT="${1:?usage: compile-rules.sh <ext-dir>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
C="node $HERE/tools/compile-sch.cjs"
O="${OUT_DIR:-$HERE/build/schemas}"
mkdir -p "$O"
$C "$EXT/einvoicing-en16931/ubl/schematron/preprocessed/EN16931-UBL-validation-preprocessed.sch" "$O/EN16931-UBL.json" --id EN16931-UBL
$C "$EXT/einvoicing-en16931/cii/schematron/preprocessed/EN16931-CII-validation-preprocessed.sch" "$O/EN16931-CII.json" --id EN16931-CII
$C "$EXT/xrechnung-schematron/build/schematron/ubl/XRechnung-UBL-validation.sch" "$O/XRechnung-UBL.json" --id XRechnung-UBL
$C "$EXT/xrechnung-schematron/build/schematron/cii/XRechnung-CII-validation.sch" "$O/XRechnung-CII.json" --id XRechnung-CII
ZF="$EXT/mustangproject/validator/src/main/resources/schematron/ZF_250"
for p in MINIMUM BASIC-WL BASIC EN16931 EXTENDED; do $C "$ZF/FACTUR-X_$p.sch" "$O/FACTUR-X-$p.json" --id "FACTUR-X-$p"; done
if [ -d "$EXT/peppol-bis-invoice-3" ]; then
  $C "$EXT/peppol-bis-invoice-3/rules/sch/PEPPOL-EN16931-UBL.sch" "$O/PEPPOL-UBL.json" --id PEPPOL-UBL
  $C "$EXT/peppol-bis-invoice-3/rules/sch/PEPPOL-EN16931-CII.sch" "$O/PEPPOL-CII.json" --id PEPPOL-CII
fi
