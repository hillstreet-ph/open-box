import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE=Path(__file__).resolve().parents[1]/'scripts'/'audit_sources.py'
spec=importlib.util.spec_from_file_location('audit_sources',MODULE)
audit_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_module)
SOURCES=Path(__file__).resolve().parents[1]/'sources'

class AuditSourceTests(unittest.TestCase):
    def setUp(self):
        self.base={p.parent.name:json.loads(p.read_text()) for p in SOURCES.glob('*/source.json')}

    def audit_modified(self, provider, change):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for key,item in self.base.items():
                x=json.loads(json.dumps(item))
                if key==provider: change(x)
                out=root/key/'source.json'
                out.parent.mkdir(parents=True)
                out.write_text(json.dumps(x))
            return audit_module.audit(root)[1]

    def test_valid_set(self):
        records,errors=audit_module.audit(SOURCES)
        self.assertEqual(len(records),6)
        self.assertFalse(errors)

    def test_duplicate_name_rejected(self):
        self.assertTrue(self.audit_modified('android', lambda x:x.update(name=self.base['macos']['name'])))

    def test_missing_provider_rejected(self):
        self.assertTrue(self.audit_modified('databricks',lambda x:x.update(provider='other')))

    def test_paid_resources_rejected(self):
        self.assertTrue(self.audit_modified('tencent-cos',lambda x:x['safety'].update(allow_paid_resources=True)))

    def test_local_execution_rejected(self):
        self.assertTrue(self.audit_modified('macos',lambda x:x['safety'].update(allow_local_execution=True)))

    def test_deletion_rejected(self):
        self.assertTrue(self.audit_modified('supabase',lambda x:x['safety'].update(allow_deletion=True)))

    def test_cutover_rejected(self):
        self.assertTrue(self.audit_modified('railway',lambda x:x['safety'].update(allow_cutover=True)))

    def test_transfer_rejected(self):
        self.assertTrue(self.audit_modified('tencent-cos',lambda x:x['safety'].update(allow_transfer=True)))

    def test_region_rejected(self):
        self.assertTrue(self.audit_modified('android',lambda x:x.update(destination_region='ap-hongkong')))

    def test_credential_key_rejected(self):
        self.assertTrue(self.audit_modified('databricks',lambda x:x.update(api_key='never-store-me')))

    def test_active_mode_rejected(self):
        self.assertTrue(self.audit_modified('supabase',lambda x:x.update(enabled=True,mode='active')))

    def test_missing_source_file_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for k,item in self.base.items():
                if k=='android':continue
                p=root/k/'source.json';p.parent.mkdir(parents=True);p.write_text(json.dumps(item))
            self.assertTrue(audit_module.audit(root)[1])

if __name__=='__main__':unittest.main()
