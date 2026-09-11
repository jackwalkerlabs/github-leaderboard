"""One-time identity backfill without changing the original statistics snapshot."""
import concurrent.futures, json, pathlib, re, subprocess
path = pathlib.Path('dist/data.json')
data = json.loads(path.read_text())
def identity(developer):
    profile = json.loads(subprocess.check_output(['gh', 'api', '--hostname', 'github.com', 'users/' + developer['login']], text=True))
    original = re.search(r'/u/(\d+)', developer['avatar_url'])
    if profile['type'] != 'User' or not original or int(original[1]) != profile['id']:
        raise ValueError('Identity changed for ' + developer['login'] + '; review manually')
    return developer['login'], profile['id']
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    identities = dict(pool.map(identity, data['developers']))
for developer in data['developers']:
    developer['id'] = identities[developer['login']]
path.write_text(json.dumps(data))
print('Verified GitHub IDs for', len(identities), 'developers; snapshot statistics unchanged.')
