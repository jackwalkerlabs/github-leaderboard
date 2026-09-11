import unittest, importlib.util, pathlib
spec = importlib.util.spec_from_file_location('listing_import', pathlib.Path(__file__).resolve().parent.parent / 'scripts/import-listings.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ListingImportTests(unittest.TestCase):
    def test_identity_rename_eligibility_and_idempotency(self):
        existing = {'fetched_at': '2026-09-11T00:00:00Z', 'developers': [], 'errors': []}
        developer = {'id': 123, 'login': 'new-login', 'repos': [{'id': 10}], 'total_stars': 100}
        def identity(url):
            self.assertEqual(url, 'https://api.github.com/user/123')
            return {'id': 123, 'login': 'new-login', 'type': 'User'}
        def collect(login):
            self.assertEqual(login, 'new-login')
            return developer
        requests = [{'github_user_id': '123', 'login': 'old-login'}]
        result, imported, skipped = module.import_requests(requests, existing, identity, collect)
        self.assertEqual(imported, ['new-login'])
        self.assertEqual(existing['developers'], [])
        self.assertEqual(module.import_requests(requests, result, identity, collect)[1], [])
        self.assertEqual(module.import_requests(requests, existing, identity, lambda _: {**developer, 'repos': []})[2], ['123'])
        self.assertEqual(module.import_requests(requests, existing, identity, lambda _: {**developer, 'id': 456})[2], ['123'])
        with self.assertRaises(ValueError):
            module.import_requests([{'github_user_id': '../secret'}], existing, identity, collect)
