#!/bin/sh
# run.sh — KoSIT-equivalent reference pipeline (test/kosit-reference/KositReference.java).
#
#   sh test/kosit-reference/run.sh build              assemble the repository layout of the official
#                                                     configuration + compile KositReference.java
#   sh test/kosit-reference/run.sh selftest           run the configuration's own test material
#                                                     (src/test/instances + src/test/integration with
#                                                     assertions.xml / assertions-integration-testing.xml)
#   sh test/kosit-reference/run.sh corpus [dirs…]     run the whole corpus (build/corpus/<dir>) ->
#                                                     build/kosit-reference/reports/<dir>/<name>-report.xml
#   sh test/kosit-reference/run.sh run [options] FILE…  arbitrary call (same CLI options as the validator)
#
# Environment (defaults: the sources below $EXT_DIR, set by tools/verify-all.cjs, else <repository>/ext):
#   SAXON_JAR          Saxon HE jar (its sibling lib/ is added to the class path when present)
#   KOSIT_VALIDATOR    clone of https://github.com/itplr-kosit/validator (for src/main/model/xsd/*.xsd)
#   KOSIT_CONFIG       clone of https://github.com/itplr-kosit/validator-configuration-xrechnung (v2026-08-31)
#   UBL_XSD_DIR        OASIS os-UBL-2.1 "xsdrt" directory (maindoc/, common/)
#   CII_XSD_DIR        directory with CrossIndustryInvoice_100pD16B.xsd and its three imports (UN/CEFACT D16B uncoupled)
#   CEN_DIR            clone of https://github.com/ConnectingEurope/eInvoicing-EN16931 (validation-1.3.16)
#   XR_XSL_DIR         directory with XRechnung-UBL-validation.xsl / XRechnung-CII-validation.xsl (ISO-skeleton
#                      compilation of the merged XRechnung Schematron); built with build-xrechnung-xsl.sh when unset
#   KOSIT_THREADS      worker threads of KositReference (default: number of processors)
#
# Resource mapping (scenario <location> -> source), documented in docs/KOSIT-REFERENCE.md:
#   resources/ubl/2.1/xsd/**                        <- $UBL_XSD_DIR/** (build.xml: unzip xsdrt/** with cutdirsmapper dirs=1)
#   resources/cii/16b/xsd/CrossIndustryInvoice*.xsd <- $CII_XSD_DIR (build.xml: flattenmapper)
#   resources/ubl/2.1/xsl/EN16931-UBL-validation.xsl <- $CEN_DIR/ubl/xslt/EN16931-UBL-validation.xslt   (DEVIATION: ISO skeleton instead of SchXslt)
#   resources/cii/16b/xsl/EN16931-CII-validation.xsl <- $CEN_DIR/cii/xslt/EN16931-CII-validation.xslt   (DEVIATION: ISO skeleton instead of SchXslt)
#   resources/xrechnung/3.0.2/xsl/XRechnung-*-validation.xsl <- convert-dynamic-id-to-static.xsl($XR_XSL_DIR/*) (as build.xml target provide-xrechnung-schematron)
#   resources/default-report.xsl, resources/xrechnung-report.xsl, resources/xsd/report.xsd <- $KOSIT_CONFIG/src/
#   scenarios.xml <- tools/compile-scenarios.cjs --emit-xml (Ant filter tokens of target compile-scenario)
set -e
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
# sources in the layout of tools/fetch-sources.cjs (EXT_DIR is set by tools/verify-all.cjs); every path can be overridden
EXT="${EXT_DIR:-$HERE/ext}"
SAXON_JAR="${SAXON_JAR:-$EXT/saxon/saxon-he-12.8.jar}"
KOSIT_VALIDATOR="${KOSIT_VALIDATOR:-$EXT/validator}"
KOSIT_CONFIG="${KOSIT_CONFIG:-$EXT/validator-configuration-xrechnung}"
UBL_XSD_DIR="${UBL_XSD_DIR:-$EXT/os-UBL-2.1/xsdrt}"
CII_XSD_DIR="${CII_XSD_DIR:-$EXT/ph-cii/ph-cii-d16b/src/main/resources/external/schemas/d16b/data/standard}"
CEN_DIR="${CEN_DIR:-$EXT/einvoicing-en16931}"
XR_XSL_DIR="${XR_XSL_DIR:-$HERE/build/reference-xsl}"
KOSIT_THREADS="${KOSIT_THREADS:-$(nproc 2>/dev/null || echo 1)}"
XR_VERSION="${XR_VERSION:-3.0.2}"
BASE="$HERE/build/kosit-reference"
REPO="$BASE/repository"
CLASSES="$BASE/classes"
XSD_DIR="$KOSIT_VALIDATOR/src/main/model/xsd"
SAXON_LIB="$(dirname "$SAXON_JAR")/lib"
CP="$SAXON_JAR:$CLASSES"
[ -d "$SAXON_LIB" ] && CP="$SAXON_JAR:$SAXON_LIB/*:$CLASSES"
export SAXON_JAR

# runs java, hides the harmless "Picked up JAVA_TOOL_OPTIONS" line, keeps the exit status
JQ_OUT="${TMPDIR:-/tmp}/kosit-reference-$$.out"
java_q() { java "$@" >"$JQ_OUT" 2>&1; rc=$?; grep -v '^Picked up JAVA_TOOL_OPTIONS' "$JQ_OUT" || true; return $rc; }
saxon() { java_q -cp "$SAXON_JAR:$SAXON_LIB/*" net.sf.saxon.Transform "$@"; }

build() {
  for f in "$SAXON_JAR" "$XSD_DIR/createReportInput.xsd" "$KOSIT_CONFIG/scenarios.xml" "$UBL_XSD_DIR/maindoc/UBL-Invoice-2.1.xsd" \
           "$CII_XSD_DIR/CrossIndustryInvoice_100pD16B.xsd" "$CEN_DIR/ubl/xslt/EN16931-UBL-validation.xslt"; do
    [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
  done
  if [ ! -e "$XR_XSL_DIR/XRechnung-UBL-validation.xsl" ]; then
    echo "XR_XSL_DIR has no XRechnung-UBL-validation.xsl — building with build-xrechnung-xsl.sh"
    XR_XSL_DIR="$BASE/xrechnung-xsl"
    sh "$HERE/test/kosit-reference/build-xrechnung-xsl.sh" "$XR_XSL_DIR"
  fi
  rm -rf "$REPO"
  mkdir -p "$REPO/resources/ubl/2.1/xsd" "$REPO/resources/ubl/2.1/xsl" "$REPO/resources/cii/16b/xsd" "$REPO/resources/cii/16b/xsl" \
           "$REPO/resources/xrechnung/$XR_VERSION/xsl" "$REPO/resources/xsd" "$CLASSES"
  cp -R "$UBL_XSD_DIR/maindoc" "$UBL_XSD_DIR/common" "$REPO/resources/ubl/2.1/xsd/"
  cp "$CII_XSD_DIR"/CrossIndustryInvoice*.xsd "$REPO/resources/cii/16b/xsd/"
  cp "$CEN_DIR/ubl/xslt/EN16931-UBL-validation.xslt" "$REPO/resources/ubl/2.1/xsl/EN16931-UBL-validation.xsl"
  cp "$CEN_DIR/cii/xslt/EN16931-CII-validation.xslt" "$REPO/resources/cii/16b/xsl/EN16931-CII-validation.xsl"
  for U in UBL CII; do
    saxon -s:"$XR_XSL_DIR/XRechnung-$U-validation.xsl" -xsl:"$KOSIT_CONFIG/src/convert-dynamic-id-to-static.xsl" \
      -o:"$REPO/resources/xrechnung/$XR_VERSION/xsl/XRechnung-$U-validation.xsl"
    [ -s "$REPO/resources/xrechnung/$XR_VERSION/xsl/XRechnung-$U-validation.xsl" ] || { echo "convert-dynamic-id-to-static failed ($U)" >&2; exit 1; }
  done
  cp "$KOSIT_CONFIG/src/default-report.xsl" "$KOSIT_CONFIG/src/xrechnung-report.xsl" "$REPO/resources/"
  cp "$KOSIT_CONFIG/src/report.xsd" "$REPO/resources/xsd/"
  cp "$XSD_DIR/scenarios.xsd" "$REPO/resources/xsd/"   # build.xml target provide-scenario-xsd
  node "$HERE/tools/compile-scenarios.cjs" "$KOSIT_CONFIG" "$BASE/scenarios.json" --emit-xml "$REPO/scenarios.xml" >/dev/null
  # test material (build.xml targets init-test / compile-test-sources / test-integration-only)
  TEST="$BASE/test"
  rm -rf "$TEST"
  mkdir -p "$TEST/instances/processing-valid" "$TEST/instances/processing-error" "$TEST/integration"
  saxon -s:"$REPO/scenarios.xml" -xsl:"$KOSIT_CONFIG/src/create-test-scenario.xsl" -o:"$TEST/scenarios.xml"
  SPEC_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BASE/scenarios.json','utf8')).properties['xrechnung.spec.id'])")"
  for sub in processing-valid processing-error; do
    for f in "$KOSIT_CONFIG/src/test/instances/$sub"/*; do
      case "$f" in
        *.xml) sed "s|@xrechnung.spec.id@|$SPEC_ID|g" "$f" > "$TEST/instances/$sub/$(basename "$f")" ;;
        *) cp "$f" "$TEST/instances/$sub/" ;;
      esac
    done
  done
  # bin001.xml is binary (a BMP): copy it unchanged so that sed cannot alter it
  cp "$KOSIT_CONFIG/src/test/instances/processing-error/bin001.xml" "$TEST/instances/processing-error/bin001.xml"
  cp "$KOSIT_CONFIG"/src/test/integration/*.xml "$TEST/integration/"
  for f in cii-br-s-08-rounding-rule cii-bt-20-cardinality-check cii-bt-20-cardinality-check-2 cii-cii-sr-454-negative-test \
           cii-cii-sr-465-negative-test cii-cii-sr-466-negative-test cii-cii-sr-475-negative-test cii-cii-sr-476-negative-test; do
    cp "$KOSIT_CONFIG/src/test/cen-unit-test/$f.xml" "$TEST/integration/"
  done
  cp "$KOSIT_CONFIG"/src/test/cen-unit-test/XRechnung-CEFACT*.xml "$TEST/integration/" 2>/dev/null || true
  javac -d "$CLASSES" -cp "$SAXON_JAR" "$HERE/test/kosit-reference/KositReference.java" "$HERE/test/kosit-reference/CheckReports.java" 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
  [ -f "$CLASSES/KositReference.class" ] && [ -f "$CLASSES/CheckReports.class" ] || { echo "javac failed" >&2; exit 1; }
  # build.xml target compile-report-schematron: src/report.sch -> report.xsl (official build: SchXslt 1.10.1; here ISO skeleton)
  SK="${PH_SCHEMATRON_DIR:-$EXT/ph-schematron}/ph-schematron-isosch/src/main/resources/external/schematron/20100710-xslt2"
  if [ -f "$SK/iso_svrl_for_xslt2.xsl" ]; then
    mkdir -p "$BASE/schematron"
    saxon -s:"$KOSIT_CONFIG/src/report.sch" -xsl:"$SK/iso_dsdl_include.xsl" -o:"$BASE/schematron/report-1.sch"
    saxon -s:"$BASE/schematron/report-1.sch" -xsl:"$SK/iso_abstract_expand.xsl" -o:"$BASE/schematron/report-2.sch"
    saxon -s:"$BASE/schematron/report-2.sch" -xsl:"$SK/iso_svrl_for_xslt2.xsl" -o:"$BASE/schematron/report.xsl" allow-foreign=true
    [ -s "$BASE/schematron/report.xsl" ] || { echo "report.sch compilation failed" >&2; exit 1; }
  else
    echo "note: ph-schematron skeleton not found ($SK) — report.sch check will be skipped"
  fi
  echo "repository: $REPO"
  echo "test material: $TEST"
  echo "classes: $CLASSES"
}

run() {
  java_q -Dkosit.xsd.dir="$XSD_DIR" -cp "$CP" KositReference --xsd-dir "$XSD_DIR" "$@"
}

# build.xml macro check-reports: report.xsd (+scenarios.xsd) schema validation, report.sch via SVRL + check-svrl.xsl
check_reports() { # reportdir svrldir
  java_q -cp "$CP" CheckReports "$REPO/resources/xsd/report.xsd" "$REPO/resources/xsd/scenarios.xsd" "$1"
  if [ -s "$BASE/schematron/report.xsl" ]; then
    rm -rf "$2"; mkdir -p "$2"
    for r in "$1"/*-report.xml; do
      saxon -s:"$r" -xsl:"$BASE/schematron/report.xsl" -o:"$2/$(basename "$r" .xml).svrl.xml"
    done
    n=$(ls "$2"/*.svrl.xml 2>/dev/null | wc -l)
    [ "$n" -gt 0 ] || { echo "No SVRL produced from $1 - the report.sch check would pass vacuously" >&2; exit 1; }
    saxon -s:"$KOSIT_CONFIG/src/check-svrl.xsl" -xsl:"$KOSIT_CONFIG/src/check-svrl.xsl" "svrl.dir=file://$2"; rc=$?
    echo "check-svrl.xsl on $n SVRL files: exit code $rc"
    [ "$rc" -eq 0 ] || exit 1
  fi
}

case "${1:-}" in
  build) build ;;
  selftest)
    [ -f "$CLASSES/KositReference.class" ] || build
    OUT="$BASE/selftest"
    rm -rf "$OUT"; mkdir -p "$OUT/processing-valid" "$OUT/processing-error" "$OUT/integration"
    set +e
    echo "=== instances/processing-valid (test scenarios.xml, assertions.xml) ==="
    run -s "$BASE/test/scenarios.xml" -r "$REPO" --html -l INFO --check-assertions "$KOSIT_CONFIG/src/test/assertions.xml" \
        -o "$OUT/processing-valid" "$BASE/test/instances/processing-valid" > "$OUT/processing-valid.log"; rc=$?
    cat "$OUT/processing-valid.log"; echo "exit code: $rc" | tee -a "$OUT/processing-valid.log"
    echo "=== instances/processing-error (test scenarios.xml, assertions.xml) ==="
    run -s "$BASE/test/scenarios.xml" -r "$REPO" --html -l INFO --check-assertions "$KOSIT_CONFIG/src/test/assertions.xml" \
        -o "$OUT/processing-error" "$BASE/test/instances/processing-error" > "$OUT/processing-error.log"; rc=$?
    cat "$OUT/processing-error.log"; echo "exit code: $rc" | tee -a "$OUT/processing-error.log"
    echo "=== check-reports (report.xsd + report.sch) for processing-valid and processing-error ==="
    (check_reports "$OUT/processing-valid" "$OUT/svrl/processing-valid"; echo "check-reports exit code: $?") | tee "$OUT/check-reports-processing-valid.log"
    (check_reports "$OUT/processing-error" "$OUT/svrl/processing-error"; echo "check-reports exit code: $?") | tee "$OUT/check-reports-processing-error.log"
    echo "=== test-processing-error (build.xml target: default-report.xsl on the fixtures processing-error-input.xml, processing-error-no-messages-input.xml, missing-svrl-input.xml) ==="
    T="$KOSIT_CONFIG/src/test"; PE="$OUT/processing-error-fixtures"; mkdir -p "$PE"; pe_fail=0
    pe_check() { # file substring expected(1=present,0=absent) label
      if grep -q -F -- "$2" "$1"; then found=1; else found=0; fi
      if [ "$found" -eq "$3" ]; then echo "  ok   $4"; else echo "  FAIL $4"; pe_fail=$((pe_fail+1)); fi
    }
    saxon -s:"$T/processing-error-input.xml" -xsl:"$KOSIT_CONFIG/src/default-report.xsl" -o:"$PE/test-pe-a-report.xml" "input-document=$T/processing-error-input.xml"
    pe_check "$PE/test-pe-a-report.xml" 'valid="false"' 1 "[A] report must have valid=false when processingError is present"
    pe_check "$PE/test-pe-a-report.xml" 'rep:accept' 0 "[A] report must contain rep:reject (not rep:accept) when processingError is present"
    pe_check "$PE/test-pe-a-report.xml" 'Verarbeitungsfehler' 1 "[A] Verarbeitungsfehler banner must appear in HTML output"
    pe_check "$PE/test-pe-a-report.xml" 'nicht vollst' 1 "[A] Inconclusive conformance text must appear"
    pe_check "$PE/test-pe-a-report.xml" 'nicht automatisiert angenommen' 1 "[A] 'Nicht automatisiert annehmen' rejection text must appear"
    saxon -s:"$T/processing-error-no-messages-input.xml" -xsl:"$KOSIT_CONFIG/src/default-report.xsl" -o:"$PE/test-pe-b-report.xml" "input-document=$T/processing-error-no-messages-input.xml"
    pe_check "$PE/test-pe-b-report.xml" 'valid="false"' 1 "[B] report must have valid=false when only processingError, no validation messages"
    pe_check "$PE/test-pe-b-report.xml" 'rep:accept' 0 "[B] report must not contain rep:accept when only processingError present"
    pe_check "$PE/test-pe-b-report.xml" 'weder Fehler noch Warnungen' 0 "[B] conformance must be inconclusive (not 'konform'), not claim zero errors"
    saxon -s:"$T/missing-svrl-input.xml" -xsl:"$KOSIT_CONFIG/src/default-report.xsl" -o:"$PE/test-pe-c-report.xml" "input-document=$T/missing-svrl-input.xml"
    pe_check "$PE/test-pe-c-report.xml" 'valid="false"' 1 "[C] report must have valid=false when SVRL result is missing"
    pe_check "$PE/test-pe-c-report.xml" 'rep:accept' 0 "[C] report must not contain rep:accept when SVRL is missing"
    pe_check "$PE/test-pe-c-report.xml" 'PROCESSING_ERROR' 1 "[C] PROCESSING_ERROR code must appear in report"
    pe_check "$PE/test-pe-c-report.xml" 'not completed' 1 "[C] 'validation step was not completed' message must appear"
    echo "test-processing-error: 12 checks, $pe_fail failed" | tee "$OUT/test-processing-error.log"
    echo "=== integration (scenarios.xml, assertions-integration-testing.xml) ==="
    run -l DEBUG -s "$REPO/scenarios.xml" -r "$REPO" --check-assertions "$KOSIT_CONFIG/src/test/assertions-integration-testing.xml" --html \
        -o "$OUT/integration" "$BASE/test/integration" > "$OUT/integration.log"; rc=$?
    cat "$OUT/integration.log"; echo "exit code: $rc" | tee -a "$OUT/integration.log"
    ;;
  corpus)
    [ -f "$CLASSES/KositReference.class" ] || build
    shift
    DIRS="${*:-xr-ubl xr-cii cen-ubl cen-cii extra-ubl extra-cii}"
    mkdir -p "$BASE/reports"
    for d in $DIRS; do
      rm -rf "$BASE/reports/$d"; mkdir -p "$BASE/reports/$d"
      echo "=== corpus $d ==="
      run -s "$REPO/scenarios.xml" -r "$REPO" --threads "$KOSIT_THREADS" -o "$BASE/reports/$d" "$HERE/build/corpus/$d" > "$BASE/reports/$d.log" || true
      tail -n 3 "$BASE/reports/$d.log"
    done
    ;;
  run) shift; run "$@" ;;
  *) echo "usage: run.sh build | selftest | corpus [dirs…] | run [options] FILE…" >&2; exit 2 ;;
esac
