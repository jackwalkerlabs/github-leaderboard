"""Find developers worth ranking and admit a few each day.

Candidates come from starred repositories, but eligibility is decided by
collect_data.collect so discovery and the daily snapshot always agree on what
counts: public, non-fork, explicitly licensed work owned by a person.

Admission is deliberately slow. Every candidate is recorded with the evidence
that admitted or rejected it, so a listing can be explained later, and rejected
logins are reconsidered on a schedule instead of being searched repeatedly.
"""
import datetime, json, os, pathlib, sys, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from collect_data import get, collect

STATE = pathlib.Path('data/discovery.json')
SNAPSHOT = pathlib.Path('dist/data.json')
CONFIG = {
    'min_total_stars': 100,       # across eligible repositories, not profile totals
    'min_followers': 0,
    'active_within_days': 365,    # at least one eligible repository pushed recently
    'max_admitted_per_day': 50,
    'max_evaluations_per_run': 250,
    # GitHub allows an Actions token roughly 1,000 requests an hour, shared with
    # the refresh this run dispatches; stop well short and resume tomorrow.
    'max_api_requests': 700,
    'recheck_near_miss_days': 30,  # within half the bar; likely to qualify later
    'recheck_rejected_days': 180,
    'bands': ['stars:5000..9999', 'stars:10000..24999', 'stars:25000..49999', 'stars:>=50000'],
    'pages_per_band': 10,          # GitHub search returns at most 1000 results per query
}


class Budget:
    """Count every GitHub request so a large run stops cleanly instead of
    failing halfway through and leaving the day's work unpublished."""

    def __init__(self, limit):
        self.limit, self.used = limit, 0

    def spent(self):
        return self.used >= self.limit

    def counting(self, fetch):
        def counted(url):
            self.used += 1
            return fetch(url)
        return counted


def load_state(path=STATE):
    if not path.exists():
        return {'version': 1, 'cursor': {'band': 0, 'page': 1}, 'admitted': [], 'evaluated': {}, 'last_run_at': None}
    return json.loads(path.read_text())


def save_state(state, path=STATE):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as temporary:
        json.dump(state, temporary, indent=1, sort_keys=True)
        temporary_path = temporary.name
    os.replace(temporary_path, path)


def advance(cursor, results, config=CONFIG):
    """Walk pages within a star band, then move to the next band and wrap around."""
    band, page = cursor['band'], cursor['page']
    if results >= 100 and page < config['pages_per_band']:
        return {'band': band, 'page': page + 1}
    return {'band': (band + 1) % len(config['bands']), 'page': 1}


def search_owners(cursor, fetch=get, config=CONFIG):
    """Return the personal owners of one page of popular repositories."""
    query = config['bands'][cursor['band']]
    url = (f'https://api.github.com/search/repositories?q={query}+fork:false'
           f'&sort=stars&order=desc&per_page=100&page={cursor["page"]}')
    items = fetch(url).get('items', [])
    owners = []
    for item in items:
        owner = item.get('owner') or {}
        if owner.get('type') == 'User' and owner.get('login') not in owners:
            owners.append(owner['login'])
    return owners, advance(cursor, len(items), config), len(items)


def due_for_recheck(record, now, config=CONFIG):
    days = config['recheck_near_miss_days'] if record.get('outcome') == 'near-miss' else config['recheck_rejected_days']
    checked = datetime.datetime.fromisoformat(record['checked_at'])
    return (now - checked).days >= days


def assess(developer, now, config=CONFIG):
    """Judge a collected developer against the bar, returning (outcome, evidence)."""
    stars = developer['total_stars']
    followers = developer.get('followers') or 0
    pushes = [r['pushed_at'] for r in developer['repos'] if r.get('pushed_at')]
    latest = max(pushes) if pushes else None
    active = bool(latest) and (now - datetime.datetime.fromisoformat(latest.replace('Z', '+00:00'))).days <= config['active_within_days']
    evidence = {'total_stars': stars, 'followers': followers, 'eligible_repos': len(developer['repos']), 'latest_push': latest}
    if stars >= config['min_total_stars'] and followers >= config['min_followers'] and active:
        return 'admitted', evidence
    # Close on both counts and still active: worth asking again sooner.
    if active and stars >= config['min_total_stars'] // 2 and followers >= config['min_followers'] // 2:
        return 'near-miss', evidence
    return 'rejected', evidence


def known_logins(snapshot_path=SNAPSHOT):
    if not snapshot_path.exists():
        return set()
    snapshot = json.loads(snapshot_path.read_text())
    return {d['login'].lower() for d in snapshot.get('developers', [])}


def run(state, now, fetch=get, collector=collect, config=CONFIG, snapshot_path=SNAPSHOT):
    known = known_logins(snapshot_path)
    admitted_logins = {entry['login'].lower() for entry in state['admitted']}
    evaluated = state['evaluated']
    admitted, evaluations, skipped, empty_pages = [], 0, 0, 0
    budget = Budget(config['max_api_requests'])
    counted = budget.counting(fetch)

    # Stop once every band has come back empty in a row: the search is exhausted
    # for now, and spinning through cursors would only burn API budget.
    while (len(admitted) < config['max_admitted_per_day'] and evaluations < config['max_evaluations_per_run']
           and empty_pages <= len(config['bands']) and not budget.spent()):
        owners, cursor, results = search_owners(state['cursor'], counted, config)
        state['cursor'] = cursor
        empty_pages = 0 if results else empty_pages + 1
        for login in owners:
            if (evaluations >= config['max_evaluations_per_run'] or len(admitted) >= config['max_admitted_per_day']
                    or budget.spent()):
                break
            key = login.lower()
            if key in known or key in admitted_logins:
                continue
            record = evaluated.get(key)
            if record and not due_for_recheck(record, now, config):
                skipped += 1
                continue
            evaluations += 1
            developer = collector(login, counted)
            if not developer:  # organizations and deleted accounts
                evaluated[key] = {'login': login, 'checked_at': now.isoformat(), 'outcome': 'not-a-person'}
                continue
            outcome, evidence = assess(developer, now, config)
            evaluated[key] = {'login': login, 'checked_at': now.isoformat(), 'outcome': outcome, **evidence}
            print(f'{login}: {outcome} ({evidence["total_stars"]:,} stars, {evidence["followers"]:,} followers)', flush=True)
            if outcome == 'admitted':
                entry = {'login': login, 'added_at': now.isoformat(), **evidence}
                state['admitted'].append(entry)
                admitted_logins.add(key)
                admitted.append(entry)
    state['last_run_at'] = now.isoformat()
    return {'admitted': admitted, 'evaluations': evaluations, 'skipped': skipped,
            'requests': budget.used, 'budget_spent': budget.spent()}


if __name__ == '__main__':
    now = datetime.datetime.now(datetime.timezone.utc)
    state = load_state()
    summary = run(state, now)
    if '--dry-run' in sys.argv:
        print('Dry run; no state written.')
    else:
        save_state(state)
    names = ', '.join(entry['login'] for entry in summary['admitted']) or 'none'
    print(f'Evaluated {summary["evaluations"]} using {summary["requests"]} API requests, '
          f'skipped {summary["skipped"]} recently checked. Admitted {len(summary["admitted"])}: {names}')
    if summary['budget_spent']:
        print('Stopped on the API request budget; the cursor resumes here tomorrow.')
