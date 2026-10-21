#!/usr/bin/env python3
"""validate_csaf.py - validates CSAF 2.0 documents and provider-metadata.json files against the official JSON schemas
of OASIS CSAF 2.0 (csaf_json_schema.json, provider_json_schema.json and the FIRST CVSS schemas they reference, from
oasis-tcs/csaf at the commit recorded in build/STANDARDS_MANIFEST.json) with the Python package jsonschema
(JSON Schema 2020-12, with the format checks jsonschema offers). Independent of tools/make-csaf.cjs: an oracle of
test/run-security-tests.cjs.

Usage: python3 -I validate_csaf.py <csaf checkout> <file.json> [<file.json> ...]
A file named provider-metadata.json is validated against the provider schema, every other file against the CSAF
schema. Prints one line per file: '<file>: valid' or '<file>: INVALID (<n> errors)' followed by the errors.
Exit status 0 when every file is valid.
Licence: EUPL-1.2
"""
import json
import os
import sys

import jsonschema


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def validators(checkout):
    base = os.path.join(checkout, 'csaf_2.0')
    csaf = load(os.path.join(base, 'json_schema', 'csaf_json_schema.json'))
    provider = load(os.path.join(base, 'json_schema', 'provider_json_schema.json'))
    first = {'https://www.first.org/cvss/cvss-v%s.json' % v: load(os.path.join(base, 'referenced_schema', 'first', 'cvss-v%s.json' % v)) for v in ('2.0', '3.0', '3.1')}
    cls = jsonschema.Draft202012Validator
    cls.check_schema(csaf)
    cls.check_schema(provider)
    resources = dict(first)
    resources[csaf['$id']] = csaf
    resources[provider['$id']] = provider
    try:  # jsonschema >= 4.18: referencing registry
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT202012, DRAFT7
        def spec(s):
            return DRAFT7 if 'draft-07' in s.get('$schema', '') else DRAFT202012
        registry = Registry().with_resources([(u, Resource.from_contents(s, default_specification=spec(s))) for u, s in resources.items()])
        return (cls(csaf, registry=registry, format_checker=cls.FORMAT_CHECKER),
                cls(provider, registry=registry, format_checker=cls.FORMAT_CHECKER))
    except ImportError:
        resolver_c = jsonschema.RefResolver(base_uri=csaf['$id'], referrer=csaf, store=resources)
        resolver_p = jsonschema.RefResolver(base_uri=provider['$id'], referrer=provider, store=resources)
        return (cls(csaf, resolver=resolver_c, format_checker=jsonschema.FormatChecker()),
                cls(provider, resolver=resolver_p, format_checker=jsonschema.FormatChecker()))


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    v_csaf, v_provider = validators(argv[1])
    try:
        from importlib.metadata import version
        jv = version('jsonschema')
    except Exception:  # noqa: BLE001 - only for the report line
        jv = '?'
    print('jsonschema ' + jv + ', CSAF schema ' + v_csaf.schema.get('$id', '?'))
    ok = True
    for doc_path in argv[2:]:
        v = v_provider if os.path.basename(doc_path) == 'provider-metadata.json' else v_csaf
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
