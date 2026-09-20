import datetime, json, pathlib, sys, tempfile, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from scripts import discover_developers as discovery

NOW = datetime.datetime(2026, 9, 20, tzinfo=datetime.timezone.utc)
CONFIG = dict(discovery.CONFIG, max_admitted_per_day=2, max_evaluations_per_run=10, max_api_requests=500)


def person(login, stars, followers=0, pushed='2026-09-01T00:00:00Z', repos=2):
    return {'login': login, 'followers': followers, 'total_stars': stars,
            'repos': [{'pushed_at': pushed, 'stargazers_count': stars // repos} for _ in range(repos)]}


def page(*logins, kind='User'):
    return {'items': [{'owner': {'login': login, 'type': kind}} for login in logins]}


class Assessment(unittest.TestCase):
    def test_clears_every_part_of_the_bar(self):
        outcome, evidence = discovery.assess(person('ada', 120), NOW, CONFIG)
        self.assertEqual(outcome, 'admitted')
        self.assertEqual(evidence['total_stars'], 120)

    def test_popular_but_dormant_work_is_not_admitted(self):
        outcome, _ = discovery.assess(person('ada', 9000, pushed='2020-01-01T00:00:00Z'), NOW, CONFIG)
        self.assertEqual(outcome, 'rejected')

    def test_just_under_the_bar_is_a_near_miss(self):
        outcome, _ = discovery.assess(person('ada', 60), NOW, CONFIG)
        self.assertEqual(outcome, 'near-miss')

    def test_followers_are_not_required(self):
        outcome, _ = discovery.assess(person('ada', 400, followers=0), NOW, CONFIG)
        self.assertEqual(outcome, 'admitted')

    def test_a_following_cannot_replace_published_work(self):
        outcome, _ = discovery.assess(person('ada', 5, followers=90000), NOW, CONFIG)
        self.assertEqual(outcome, 'rejected')

    def test_developer_without_eligible_repositories_is_rejected(self):
        outcome, evidence = discovery.assess({'login': 'ada', 'followers': 9000, 'total_stars': 0, 'repos': []}, NOW, CONFIG)
        self.assertEqual(outcome, 'rejected')
        self.assertIsNone(evidence['latest_push'])


class Recheck(unittest.TestCase):
    def test_near_miss_is_reconsidered_sooner_than_a_rejection(self):
        checked = (NOW - datetime.timedelta(days=45)).isoformat()
        self.assertTrue(discovery.due_for_recheck({'outcome': 'near-miss', 'checked_at': checked}, NOW, CONFIG))
        self.assertFalse(discovery.due_for_recheck({'outcome': 'rejected', 'checked_at': checked}, NOW, CONFIG))


class Cursor(unittest.TestCase):
    def test_full_page_advances_within_the_band(self):
        self.assertEqual(discovery.advance({'band': 0, 'page': 1}, 100, CONFIG), {'band': 0, 'page': 2})

    def test_short_page_moves_to_the_next_band(self):
        self.assertEqual(discovery.advance({'band': 0, 'page': 3}, 12, CONFIG), {'band': 1, 'page': 1})

    def test_last_band_wraps_around(self):
        last = len(CONFIG['bands']) - 1
        self.assertEqual(discovery.advance({'band': last, 'page': 1}, 4, CONFIG), {'band': 0, 'page': 1})

    def test_band_exhausts_after_its_page_limit(self):
        limit = CONFIG['pages_per_band']
        self.assertEqual(discovery.advance({'band': 0, 'page': limit}, 100, CONFIG), {'band': 1, 'page': 1})


class Run(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.snapshot = pathlib.Path(self.directory.name) / 'data.json'
        self.snapshot.write_text(json.dumps({'developers': [{'login': 'Sindresorhus'}]}))
        self.addCleanup(self.directory.cleanup)

    def go(self, pages, people, state=None):
        collected = []

        def fetch(url):
            if '/search/' not in url:  # a counted request from the collector
                return {}
            return pages.pop(0) if pages else {'items': []}

        def collector(login, graph=None):
            collected.append(login)
            if graph:
                graph({'login': login, 'cursor': None})
            return people.get(login)

        state = state or discovery.load_state(pathlib.Path(self.directory.name) / 'missing.json')
        summary = discovery.run(state, NOW, fetch, collector, CONFIG, self.snapshot, graph=lambda variables: {})
        return state, summary, collected

    def test_admits_qualifying_people_and_stops_at_the_daily_cap(self):
        pages = [page('ada', 'bob', 'cleo')]
        people = {name: person(name, 9000) for name in ['ada', 'bob', 'cleo']}
        state, summary, collected = self.go(pages, people)
        self.assertEqual([entry['login'] for entry in summary['admitted']], ['ada', 'bob'])
        self.assertNotIn('cleo', collected)

    def test_developers_already_listed_are_never_re_evaluated(self):
        # The snapshot stores "Sindresorhus"; search returns a different casing.
        state, summary, collected = self.go([page('sindresorhus', 'ada')], {'ada': person('ada', 9000)})
        self.assertEqual(collected, ['ada'])

    def test_organizations_are_recorded_and_not_admitted(self):
        state, summary, _ = self.go([page('acme-corp'), page('ada')], {'acme-corp': None, 'ada': person('ada', 9000)})
        self.assertEqual(state['evaluated']['acme-corp']['outcome'], 'not-a-person')
        self.assertEqual([entry['login'] for entry in summary['admitted']], ['ada'])

    def test_recently_rejected_logins_are_skipped_without_an_api_call(self):
        state = discovery.load_state(pathlib.Path(self.directory.name) / 'missing.json')
        state['evaluated']['bob'] = {'login': 'bob', 'checked_at': NOW.isoformat(), 'outcome': 'rejected'}
        _, summary, collected = self.go([page('bob', 'ada')], {'ada': person('ada', 9000)}, state)
        self.assertNotIn('bob', collected)
        self.assertEqual(summary['skipped'], 1)

    def test_evaluation_budget_bounds_a_barren_search(self):
        pages = [page(*[f'user{index}' for index in range(100)])]
        people = {f'user{index}': person(f'user{index}', 2) for index in range(100)}
        _, summary, collected = self.go(pages, people)
        self.assertEqual(summary['evaluations'], CONFIG['max_evaluations_per_run'])
        self.assertEqual(len(collected), CONFIG['max_evaluations_per_run'])

    def test_api_budget_stops_the_run_before_the_daily_cap(self):
        # Each candidate costs one counted request in this fake collector.
        config = dict(CONFIG, max_admitted_per_day=50, max_evaluations_per_run=50, max_api_requests=4)
        names = [f'user{index}' for index in range(50)]
        people = {name: person(name, 9000) for name in names}
        collected = []

        def fetch(url):
            return {} if '/search/' not in url else page(*names)

        def collector(login, graph=None):
            collected.append(login)
            graph({'login': login, 'cursor': None})
            return people.get(login)

        state = discovery.load_state(pathlib.Path(self.directory.name) / 'missing.json')
        summary = discovery.run(state, NOW, fetch, collector, config, self.snapshot, graph=lambda variables: {})
        self.assertTrue(summary['budget_spent'])
        self.assertLess(len(summary['admitted']), config['max_admitted_per_day'])
        self.assertLessEqual(summary['requests'], config['max_api_requests'])
        # The cursor advanced, so tomorrow's run continues rather than repeating.
        self.assertNotEqual(state['cursor'], {'band': 0, 'page': 1})

    def test_admissions_and_evidence_survive_a_save_and_reload(self):
        state, _, _ = self.go([page('ada')], {'ada': person('ada', 9000)})
        path = pathlib.Path(self.directory.name) / 'discovery.json'
        discovery.save_state(state, path)
        reloaded = discovery.load_state(path)
        self.assertEqual(reloaded['admitted'][0]['login'], 'ada')
        self.assertEqual(reloaded['cursor'], state['cursor'])


class CollectorIntegration(unittest.TestCase):
    def test_admitted_developers_become_collection_candidates(self):
        import collect_data
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = pathlib.Path(directory.name) / 'discovery.json'
        path.write_text(json.dumps({'admitted': [{'login': 'ada'}, {'login': 'bob'}]}))
        self.assertEqual(collect_data.discovered(path), ['ada', 'bob'])

    def test_missing_discovery_file_is_not_an_error(self):
        import collect_data
        self.assertEqual(collect_data.discovered(pathlib.Path('data/does-not-exist.json')), [])


if __name__ == '__main__':
    unittest.main()
