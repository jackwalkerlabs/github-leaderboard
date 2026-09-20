import importlib.util
import json
import unittest
import tempfile
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

    def test_only_licensed_nonfork_repos_count(self):
        def node(**overrides):
            base = dict(databaseId=42, name='tool', nameWithOwner='alice/tool', url='https://github.com/alice/tool',
                        description=None, homepageUrl=None, stargazerCount=12, forkCount=3, isFork=False,
                        isArchived=False, pushedAt='2026-09-01T00:00:00Z', createdAt='2020-01-01T00:00:00Z',
                        primaryLanguage={'name': 'Rust'}, licenseInfo={'key': 'mit', 'name': 'MIT License', 'spdxId': 'MIT', 'url': 'x'},
                        repositoryTopics={'nodes': [{'topic': {'name': 'cli'}}]})
            return {**base, **overrides}
        nodes = [node(), node(isFork=True), node(licenseInfo=None), node(licenseInfo={'key': 'other', 'name': 'Other', 'spdxId': 'NOASSERTION', 'url': 'x'})]
        user = {'databaseId': 123, 'login': 'alice', 'name': 'Alice', 'avatarUrl': 'https://avatars.githubusercontent.com/u/123?u=hash&v=4',
                'url': 'https://github.com/alice', 'bio': '', 'location': None, 'followers': {'totalCount': 7},
                'repositories': {'pageInfo': {'hasNextPage': False, 'endCursor': None}, 'nodes': nodes}}
        result = collector.collect('alice', lambda variables: user)
        self.assertEqual(result['id'], 123)
        self.assertEqual(result['total_stars'], 12)
        self.assertEqual(result['total_forks'], 3)
        self.assertEqual(result['excluded_repos'], 3)
        self.assertEqual(result['repos'][0]['id'], 42)
        # The stored shape must stay exactly what the REST collector produced.
        self.assertEqual(result['repos'][0]['license']['spdx_id'], 'MIT')
        self.assertEqual(result['repos'][0]['language'], 'Rust')
        self.assertEqual(result['repos'][0]['full_name'], 'alice/tool')
        self.assertEqual(result['avatar_url'], 'https://avatars.githubusercontent.com/u/123?v=4')
        self.assertIsNone(result['bio'])
        self.assertEqual(result['followers'], 7)

    def test_every_page_of_repositories_is_collected(self):
        def node(name, stars):
            return dict(databaseId=hash(name) % 10000, name=name, nameWithOwner=f'alice/{name}', url='u', description=None,
                        homepageUrl=None, stargazerCount=stars, forkCount=0, isFork=False, isArchived=False,
                        pushedAt='2026-09-01T00:00:00Z', createdAt='2020-01-01T00:00:00Z', primaryLanguage=None,
                        licenseInfo={'key': 'mit', 'name': 'MIT License', 'spdxId': 'MIT', 'url': 'x'},
                        repositoryTopics={'nodes': []})
        profile = {'databaseId': 1, 'login': 'alice', 'name': None, 'avatarUrl': 'https://a/1?v=4', 'url': 'u',
                   'bio': None, 'location': None, 'followers': {'totalCount': 0}}
        pages = [
            {**profile, 'repositories': {'pageInfo': {'hasNextPage': True, 'endCursor': 'CUR'}, 'nodes': [node('first', 5)]}},
            {**profile, 'repositories': {'pageInfo': {'hasNextPage': False, 'endCursor': None}, 'nodes': [node('second', 9)]}},
        ]
        cursors = []

        def graph(variables):
            cursors.append(variables['cursor'])
            return pages[len(cursors) - 1]

        result = collector.collect('alice', graph)
        self.assertEqual(cursors, [None, 'CUR'])
        self.assertEqual(result['total_stars'], 14)
        self.assertEqual([r['name'] for r in result['repos']], ['second', 'first'])

    def test_organizations_are_skipped(self):
        self.assertIsNone(collector.collect('acme', lambda variables: None))

    def test_a_missing_user_is_skipped_although_gh_exits_non_zero(self):
        # gh returns a failing exit code whenever GraphQL reports errors; an
        # organization looked up as a user is one, and must not fail a refresh.
        body = '{"data":{"user":null},"errors":[{"type":"NOT_FOUND","message":"Could not resolve to a User."}]}'
        with patch.object(collector.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout=body, stderr='gh: error')):
            self.assertIsNone(collector.graphql({'login': 'astral-sh'}))

    def test_other_graphql_errors_still_fail_loudly(self):
        body = '{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}'
        with patch.object(collector.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout=body, stderr='')):
            with self.assertRaises(RuntimeError):
                collector.graphql({'login': 'alice'})

    def test_history_preserves_first_complete_observation_and_stable_ids(self):
        snapshot = {'fetched_at': '2026-09-11T16:00:00Z', 'errors': [], 'developers': [
            {'id': 123, 'login': 'alice', 'fetched_at': '2026-09-11T15:59:00Z', 'repos': [
                {'id': 42, 'full_name': 'alice/tool', 'stargazers_count': 12, 'forks_count': 3, 'archived': False, 'language': 'Rust'}]}]}
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            self.assertTrue(collector.save_history(snapshot, directory))
            path = directory / '2026-09-11.json'
            original = path.read_bytes()
            snapshot['developers'][0]['repos'][0]['stargazers_count'] = 20
            self.assertFalse(collector.save_history(snapshot, directory))
            self.assertEqual(path.read_bytes(), original)
            snapshot['fetched_at'] = '2026-09-12T16:00:00Z'
            with self.assertRaises(ValueError): collector.save_history(snapshot, directory)
            snapshot['developers'][0]['fetched_at'] = '2026-09-12T15:59:00Z'
            snapshot['developers'][0]['repos'][0]['full_name'] = 'alice/renamed-tool'
            self.assertTrue(collector.save_history(snapshot, directory))
            next_repo = json.loads((directory / '2026-09-12.json').read_text())['developers'][0]['repos'][0]
            self.assertEqual(next_repo['id'], 42)
            self.assertEqual(next_repo['stargazers_count'], 20)
            snapshot['errors'] = [{'login': 'bob', 'error': 'unavailable'}]
            with self.assertRaises(ValueError): collector.save_history(snapshot, directory)
            snapshot['errors'] = []
            del snapshot['developers'][0]['repos'][0]['id']
            with self.assertRaises(ValueError): collector.save_history(snapshot, directory)

    def test_snapshot_integrity(self):
        data = json.loads((Path(__file__).resolve().parents[1] / 'dist/data.json').read_text())
        ids = [d['id'] for d in data['developers']]
        self.assertEqual(len(ids), len(set(ids)))
        for developer in data['developers']:
            self.assertEqual(developer['total_stars'], sum(r['stargazers_count'] for r in developer['repos']))
            self.assertEqual(developer['total_forks'], sum(r['forks_count'] for r in developer['repos']))
            for repo in developer['repos']:
                self.assertIsInstance(repo['id'], int)
                self.assertEqual(repo['full_name'].split('/')[0].lower(), developer['login'].lower())
                self.assertNotIn(repo['license']['spdx_id'], ['NONE', 'NOASSERTION'])

if __name__ == '__main__':
    unittest.main()
