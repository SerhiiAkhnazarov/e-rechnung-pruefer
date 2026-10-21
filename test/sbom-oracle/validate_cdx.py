#!/usr/bin/env python3
"""validate_cdx.py - validates CycloneDX JSON documents against the official CycloneDX 1.6 JSON schema
(bom-1.6.schema.json with spdx.schema.json and jsf-0.82.schema.json from CycloneDX/specification at the commit
recorded in build/STANDARDS_MANIFEST.json) with the Python package jsonschema (Draft 7, with the format checks
jsonschema offers). Independent of tools/make-sbom.cjs: an oracle of test/run-sbom-tests.cjs.

Usage: python3 -I validate_cdx.py <schema dir> <document.json> [<document.json> ...]
Prints one line per document: '<file>: valid' or '<file>: INVALID (<n> errors)' followed by the errors.
Exit status 0 when every document is valid.
Licence: EUPL-1.2
"""
import json
import os
import sys

import jsonschema


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def validator_for(schema_dir):
    bom = load(os.path.join(schema_dir, 'bom-1.6.schema.json'))
    others = [load(os.path.join(schema_dir, n)) for n in ('spdx.schema.json', 'jsf-0.82.schema.json')]
    cls = jsonschema.Draft7Validator
    cls.check_schema(bom)
    if not os.environ.get('VALIDATE_CDX_RESOLVER'):
        try:  # jsonschema >= 4.18: referencing registry
            from referencing import Registry, Resource
            from referencing.jsonschema import DRAFT7
            registry = Registry().with_resources([(s['$id'], Resource.from_contents(s, default_specification=DRAFT7)) for s in [bom] + others])
            return cls(bom, registry=registry, format_checker=jsonschema.FormatChecker())
        except (ImportError, TypeError):
            pass
    # older jsonschema (e.g. python3-jsonschema 4.10 of Ubuntu 24.04): RefResolver with a store
    store = {s['$id']: s for s in [bom] + others}
    resolver = jsonschema.RefResolver(base_uri=bom['$id'], referrer=bom, store=store)
    return cls(bom, resolver=resolver, format_checker=jsonschema.FormatChecker())


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    v = validator_for(argv[1])
    ok = True
    try:
        from importlib.metadata import version
        jv = version('jsonschema')
    except Exception:  # noqa: BLE001 - only for the report line
        jv = '?'
    print('jsonschema ' + jv + ', CycloneDX schema ' + v.schema.get('$id', '?'))
    for doc_path in argv[2:]:
        errors = sorted(v.iter_errors(load(doc_path)), key=lambda e: list(e.absolute_path))
        if errors:
            ok = False
            print(doc_path + ': INVALID (' + str(len(errors)) + ' errors)')
            for e in errors[:20]:
                print('  /' + '/'.join(str(p) for p in e.absolute_path) + ': ' + e.message[:300])
        else:
            print(doc_path + ': valid')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
