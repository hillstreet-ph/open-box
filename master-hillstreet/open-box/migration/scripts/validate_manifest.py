#!/usr/bin/env python3
"""Read-only manifest validation. Never connects to cloud or moves data."""
import argparse
import json
import re
from pathlib import Path

ALLOWED_SCHEMA = 'hillstreet.master-migration/v1'
NAME = re.compile(r'^open-box-hk-(?:prod|stage)-[a-z0-9]+(?:-[a-z0-9]+)*$')
FORBIDDEN_KEYS = ('password', 'secret', 'api_key', 'token', 'private_key', 'credential', 'dsn')


def validate(plan):
    errors = []
    if not isinstance(plan, dict):
        return ['Plan must be an object']
    if plan.get('schema') != ALLOWED_SCHEMA:
        errors.append('Unexpected schema')
    if plan.get('environment') != 'prod':
        errors.append('Only the declared prod naming scope is supported')
    region = plan.get('region', {})
    if not isinstance(region, dict) or region.get('target_country') != 'HK' or region.get('tencent') != 'ap-hongkong':
        errors.append('Hong Kong target default required')
    if isinstance(region, dict) and region.get('existing_sources', {}).get('supabase') != 'ap-southeast-1':
        errors.append('Existing Singapore Supabase location must remain accurate')
    execution = plan.get('execution')
    if not isinstance(execution, dict):
        errors.append('Execution policy missing')
    else:
        expected = {
            'dry_run_only': True,
            'allow_paid_resources': False,
            'allow_local_execution': False,
            'automatic_deletion': False,
            'production_cutover': False,
            'automated_data_transfer': False,
        }
        for key, value in expected.items():
            if execution.get(key) is not value:
                errors.append(f'Unsafe or missing execution control: {key}')
    names = set()
    resources = plan.get('resources')
    if not isinstance(resources, list) or not resources:
        errors.append('At least one resource is required')
        resources = []
    for item in resources:
        if not isinstance(item, dict):
            errors.append('Resource must be an object')
            continue
        name = item.get('name')
        if not isinstance(name, str) or not NAME.fullmatch(name):
            errors.append(f'Invalid resource name: {name!r}')
        if name in names:
            errors.append(f'Duplicate resource name: {name}')
        names.add(name)
        if item.get('enabled') is not False:
            errors.append(f'Activation is not permitted in staging plan: {name}')
        if item.get('status') not in ('verified-source', 'unverified'):
            errors.append(f'Invalid resource state: {name}')
    def scan(obj, path=''):
        if isinstance(obj, dict):
            for key, val in obj.items():
                safe_key = key.lower().replace('-', '_')
                if any(fragment in safe_key for fragment in FORBIDDEN_KEYS):
                    errors.append(f'Forbidden credential-like property: {path}.{key}')
                scan(val, f'{path}.{key}')
        elif isinstance(obj, list):
            for item in obj:
                scan(item, path)
    scan(plan)
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    plan = json.loads(args.manifest.read_text(encoding='utf-8'))
    errors = validate(plan)
    if errors:
        for issue in errors:
            print(f'FAIL {issue}')
        return 1
    print('PASS dry-run-only, Hong Kong-target migration manifest')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
