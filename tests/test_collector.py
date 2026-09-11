import importlib.util
import json
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path
spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[1] / 'collect_data.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class CollectorTests(unittest.TestCase):
    def test_uses_gh_api_without_copying_credentials(self):
        with patch.object(collector.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{"id": 123}')) as run:
            self.assertEqual(collector.get('https://api.github.com/users/alice')['id'], 123)
            self.assertEqual(run.call_args.args[0][:5], ['gh', 'api', '--hostname', 'github.com', 'users/alice'])

    def test_only_public_licensed_nonfork_repos_count(self):
        base = dict(name='tool', full_name='alice/tool', private=False, fork=False, stargazers_count=12, forks_count=3, license={'spdx_id':'MIT'})
        repos = [base, dict(base, private=True), dict(base, fork=True), dict(base, license=None), dict(base, license={'spdx_id':'NOASSERTION'})]
        with patch.object(collector, 'get', side_effect=[{'id':123,'login':'alice','type':'User'}, repos]):
            result = collector.collect('alice')
            self.assertEqual(result['id'], 123)
            self.assertEqual(result['total_stars'], 12)
            self.assertEqual(result['total_forks'], 3)
            self.assertEqual(result['excluded_repos'], 4)

    def test_snapshot_integrity(self):
        data = json.loads((Path(__file__).resolve().parents[1] / 'dist/data.json').read_text())
        ids = [d['id'] for d in data['developers']]
        self.assertEqual(len(ids), len(set(ids)))
        for developer in data['developers']:
            self.assertEqual(developer['total_stars'], sum(r['stargazers_count'] for r in developer['repos']))
            self.assertEqual(developer['total_forks'], sum(r['forks_count'] for r in developer['repos']))
            for repo in developer['repos']:
                self.assertEqual(repo['full_name'].split('/')[0].lower(), developer['login'].lower())
                self.assertNotIn(repo['license']['spdx_id'], ['NONE', 'NOASSERTION'])

if __name__ == '__main__':
    unittest.main()
