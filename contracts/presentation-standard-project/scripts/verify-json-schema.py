#!/usr/bin/env python3
from __future__ import annotations
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

root = Path(__file__).resolve().parents[1]
version = '0.1.0'
schema_root = root / 'schemas' / version
schemas = sorted(schema_root.glob('*.schema.json'))
if len(schemas) != 8:
    raise SystemExit(f'expected 8 schemas, found {len(schemas)}')
registry = Registry()
by_id = {}
for path in schemas:
    schema = json.loads(path.read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    if schema.get('$schema') != 'https://json-schema.org/draft/2020-12/schema':
        raise SystemExit(f'{path}: wrong JSON Schema dialect')
    registry = registry.with_resource(schema['$id'], Resource.from_contents(schema))
    by_id[schema['$id']] = schema

projects = [
    root / 'fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project',
    root / 'examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief',
]
count = 0
for project in projects:
    for path in sorted(project.rglob('*.json')):
        if path.name == 'manifest.json' or path.name in {'project.json','rules.json','outline.json'} or path.parent.name == 'drafts':
            document = json.loads(path.read_text(encoding='utf-8'))
            schema = by_id.get(document.get('$schema'))
            if schema is None:
                raise SystemExit(f'{path}: unknown $schema')
            errors = sorted(Draft202012Validator(schema, registry=registry, format_checker=FormatChecker()).iter_errors(document), key=lambda e: list(e.path))
            if errors:
                raise SystemExit(f'{path}: {errors[0].message} at {list(errors[0].path)}')
            count += 1
print(f'jsonSchemas=PASS schemas={len(schemas)} primary=7 documents={count}')
