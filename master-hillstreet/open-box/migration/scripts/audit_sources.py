#!/usr/bin/env python3
"""Validate source migration manifests without remote access or changing data."""
import argparse
import json
import re
import sys
from pathlib import Path

REGION = 'hk'
PROJECTS = {'open-box'}
SOURCE_SLUG = re.compile(r'^open-box-sg-(?:prod|stage)-[a-z0-9]+(?:-[a-z0-9]+)*$')
TARGET_SLUG = re.compile(r'^open-box-hk-(?:prod|stage)-[a-z0-9]+(?:-[a-z0-9]+)*$')
CREDENTIAL_WORDS = ('password','secret','token','private_key','api_key','access_key','dsn','cookie','credential')
PLATFORMS = {'supabase','databricks','tencent-cos','railway','macos','android'}


def audit(root: Path) -> tuple[list[dict], list[str]]:
    errors, records, names = [], [], set()
    for file in sorted(root.glob('*/source.json')):
        try:
            item = json.loads(file.read_text(encoding='utf-8'))
        except (ValueError, OSError) as exc:
            errors.append(f'{file}: unreadable JSON: {exc}')
            continue
        if not isinstance(item, dict):
            errors.append(f'{file}: expected JSON object')
            continue
        provider = file.parent.name
        name = item.get('name')
        if provider not in PLATFORMS or item.get('provider') != provider:
            errors.append(f'{file}: unexpected provider')
        if item.get('schema') != 'hillstreet.migration-source/v1':
            errors.append(f'{file}: unsupported schema')
        if item.get('project') not in PROJECTS or not isinstance(name,str) or not SOURCE_SLUG.fullmatch(name):
            errors.append(f'{file}: invalid project or Singapore name')
        if not isinstance(item.get('target_name'), str) or not TARGET_SLUG.fullmatch(item['target_name']):
            errors.append(f'{file}: missing or invalid Hong Kong target alias')
        if name in names:
            errors.append(f'{file}: duplicate name {name}')
        names.add(name)
        if item.get('destination_region') != 'ap-hongkong':
            errors.append(f'{file}: non-Hong-Kong destination')
        if item.get('mode') != 'inventory-only' or item.get('enabled') is not False:
            errors.append(f'{file}: migration must remain disabled and inventory-only')
        for k in ['allow_paid_resources','allow_local_execution','allow_deletion','allow_cutover','allow_transfer']:
            if item.get('safety',{}).get(k) is not False:
                errors.append(f'{file}: unsafe/missing {k}')
        if not isinstance(item.get('source_status'),str) or item.get('source_status') not in {'verified-inventory','unverified','partially-verified'}:
            errors.append(f'{file}: invalid source state')
        def scan(o, trail=''):
            if isinstance(o, dict):
                for k,v in o.items():
                    lk=k.lower().replace('-','_')
                    if any(x in lk for x in CREDENTIAL_WORDS):
                        errors.append(f'{file}: prohibited credential key at {trail}.{k}')
                    scan(v, trail+'.'+k)
            elif isinstance(o,list):
                for i,x in enumerate(o):scan(x,f'{trail}[{i}]')
        scan(item)
        records.append({'name':name, 'provider':provider, 'status':item.get('source_status'), 'mode':item.get('mode')})
    if len(records) != len(PLATFORMS):
        errors.append(f'Expected {len(PLATFORMS)} source manifests, found {len(records)}')
    return records, errors


def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('root',type=Path,help='Path to master-migration/sources')
    ap.add_argument('--json',action='store_true',help='Emit machine-readable inventory')
    args=ap.parse_args()
    records,errors=audit(args.root)
    if args.json:
        print(json.dumps({'records':records,'errors':errors,'ok':not errors},indent=2))
    else:
        for record in records:print(f"{record['provider']}: {record['name']} [{record['status']}]")
        for error in errors:print(f'ERROR {error}',file=sys.stderr)
        print('PASS source manifests safe' if not errors else 'FAIL source manifests unsafe')
    return int(bool(errors))

if __name__=='__main__':raise SystemExit(main())
