"""Import verified listing requests into the local snapshot using gh (no deployment)."""
import sys, json, subprocess, pathlib, tempfile, os, datetime
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from collect_data import get, collect

def import_requests(requests, snapshot, fetch_profile=get, fetch_projects=collect):
    developers = list(snapshot['developers'])
    imported, skipped = [], []
    for request in requests:
        identity = str(request['github_user_id'])
        if not identity.isascii() or not identity.isdigit():
            raise ValueError('Invalid GitHub user ID in listing request')
        if any(str(d['id']) == identity for d in developers):
            continue
        # Resolve immutable ID again: submitted login can have changed since admission.
        profile = fetch_profile('https://api.github.com/user/' + identity)
        if str(profile['id']) != identity or profile['type'] != 'User':
            skipped.append(identity)
            continue
        developer = fetch_projects(profile['login'])
        if not developer or str(developer['id']) != identity or not developer['repos']:
            skipped.append(identity)
            continue
        if any(d['login'].lower() == developer['login'].lower() for d in developers):
            raise ValueError('Login identity changed; refresh the snapshot before importing')
        developers.append(developer)
        imported.append(developer['login'])
    return {**snapshot, 'developers': sorted(developers, key=lambda d: -d['total_stars'])}, imported, skipped

if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ['--local', '--remote']:
        raise SystemExit('Usage: npm run listings:import -- --local | --remote (reads D1, updates local snapshot only)')
    result = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'starboard', sys.argv[1], '--json', '--command',
                             'SELECT github_user_id FROM listing_requests ORDER BY requested_at, github_user_id'],
                            capture_output=True, text=True, check=True)
    rows = [row for result in json.loads(result.stdout) for row in result.get('results', [])]
    path = pathlib.Path('dist/data.json')
    snapshot, imported, skipped = import_requests(rows, json.loads(path.read_text()))
    if imported:
        # Mixed-date import is not a complete daily historical baseline.
        snapshot['fetched_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as temporary:
            json.dump(snapshot, temporary, separators=(',', ':'))
        os.replace(temporary.name, path)
    print(f'Imported {len(imported)} builders: {", ".join(imported)}. Skipped {len(skipped)} accounts without eligible projects.')
    print('Run data:refresh, tests and build before publishing. Imports do not claim a profile or add historical achievements.')
