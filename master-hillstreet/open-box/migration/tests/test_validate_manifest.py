import copy
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from validate_manifest import validate

DATA = pathlib.Path(__file__).resolve().parents[1] / 'config' / 'hongkong.json'


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.plan = json.loads(DATA.read_text(encoding='utf8'))

    def test_staged_manifest_valid(self):
        self.assertEqual(validate(self.plan), [])

    def test_reject_all_prod_actions_when_sources_unverified(self):
        changed = copy.deepcopy(self.plan)
        changed['execution']['production_cutover'] = True
        self.assertTrue(validate(changed))

    def test_reject_duplicate_project_resource_name(self):
        changed = copy.deepcopy(self.plan)
        changed['resources'][1]['name'] = changed['resources'][0]['name']
        self.assertTrue(validate(changed))

    def test_reject_wrong_region(self):
        changed = copy.deepcopy(self.plan)
        changed['region']['tencent'] = 'ap-singapore'
        self.assertTrue(validate(changed))

    def test_uses_hongkong_target_with_singapore_sources(self):
        self.assertEqual(self.plan['region']['tencent'], 'ap-hongkong')
        self.assertEqual(self.plan['region']['existing_sources']['supabase'], 'ap-southeast-1')

    def test_reject_invalid_names(self):
        changed = copy.deepcopy(self.plan)
        changed['resources'][0]['name'] = 'PRODUCTION-OPEN_BOX'
        self.assertTrue(validate(changed))

    def test_reject_secret_in_plan(self):
        changed = copy.deepcopy(self.plan)
        changed['secret_key'] = 'not-a-real-credential'
        self.assertTrue(validate(changed))

    def test_reject_unapproved_spend(self):
        changed = copy.deepcopy(self.plan)
        changed['execution']['allow_paid_resources'] = True
        self.assertTrue(validate(changed))

    def test_reject_active_without_verified_target(self):
        changed = copy.deepcopy(self.plan)
        changed['resources'][1]['enabled'] = True
        self.assertTrue(validate(changed))


if __name__ == '__main__':
    unittest.main()
