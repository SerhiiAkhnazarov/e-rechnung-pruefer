#!/bin/sh
# compile-xsd-models.sh — compiles every XSD validation model of the product (build/xsd/) from the
# pinned schema sources (build/STANDARDS_MANIFEST.json).
# Usage: sh tools/compile-xsd-models.sh <ext-dir>   (layout: os-UBL-2.1 = unzipped ph-ubl docs/UBL-2.1.zip,
#        ph-cii, mustangproject; see tools/verify-all.cjs)
set -e
EXT="${1:?usage: compile-xsd-models.sh <ext-dir>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
C="node $HERE/tools/compile-xsd.cjs"
O="${OUT_DIR:-$HERE/build/xsd}"
mkdir -p "$O"
$C "$EXT/os-UBL-2.1/xsdrt/maindoc/UBL-Invoice-2.1.xsd" "$O/UBL-Invoice-2.1.json"
$C "$EXT/os-UBL-2.1/xsdrt/maindoc/UBL-CreditNote-2.1.xsd" "$O/UBL-CreditNote-2.1.json"
$C "$EXT/ph-cii/ph-cii-d16b/src/main/resources/external/schemas/d16b/data/standard/CrossIndustryInvoice_100pD16B.xsd" "$O/CII-D16B.json"
ZF="$EXT/mustangproject/validator/src/main/resources/schema/ZF_250"
$C "$ZF/MINIMUM/FACTUR-X_MINIMUM.xsd" "$O/FACTUR-X-MINIMUM.json"
$C "$ZF/BASIC-WL/FACTUR-X_BASICWL.xsd" "$O/FACTUR-X-BASIC-WL.json"
$C "$ZF/BASIC/FACTUR-X_BASIC.xsd" "$O/FACTUR-X-BASIC.json"
$C "$ZF/EN16931/FACTUR-X_EN16931.xsd" "$O/FACTUR-X-EN16931.json"
$C "$ZF/EXTENDED/FACTUR-X_EXTENDED.xsd" "$O/FACTUR-X-EXTENDED.json"
