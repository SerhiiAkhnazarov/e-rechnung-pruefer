# expat_lines.py — reference for the line numbers of the findings: libexpat (via the Python standard library,
# xml.parsers.expat) reports, for every element, the line of the first character of its start tag
# (XML_GetCurrentLineNumber in the start-element handler). Reads file paths (one per line) from stdin and writes one
# JSON object per file: {"f": path, "lines": [...]} or {"f": path, "error": message}.
# Run with python3 -I (isolated: no user site, no current directory on the module path).
# Licence: EUPL-1.2
import json
import sys
import xml.parsers.expat

for path in sys.stdin.read().split('\n'):
    if not path:
        continue
    lines = []
    parser = xml.parsers.expat.ParserCreate()
    parser.StartElementHandler = lambda name, attrs: lines.append(parser.CurrentLineNumber)
    try:
        with open(path, 'rb') as fh:
            parser.Parse(fh.read(), True)
        out = {'f': path, 'lines': lines}
    except Exception as e:  # not well-formed, unsupported encoding: no reference for this file
        out = {'f': path, 'error': str(e)}
    sys.stdout.write(json.dumps(out) + '\n')
sys.stdout.write(json.dumps({'expat': xml.parsers.expat.EXPAT_VERSION}) + '\n')
