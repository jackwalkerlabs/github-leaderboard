import json, subprocess, concurrent.futures, datetime, pathlib, os, tempfile
USERS=['sindresorhus','antfu','tj','shadcn','steipete','karpathy','jesseduffield','sharkdp','BurntSushi','ggerganov','yyx990803','taylorotwell','mitsuhiko','tiangolo','sebastianbergmann','jakevdp','davidhalter','mrousavy','junegunn','vinta','donnemartin','ThePrimeagen','k0kubun','fogleman','hakimel','wesbos','simonw','mattn','lepture','jgm','rs','jesseduffield','chubin','sxyazi','ajeetdsouza','koalaman','nate-parrott','antonmedv','astral-sh','imsnif','casey','PatrickJS','sampotts','broofa','alecthomas']
def discovered(path=pathlib.Path('data/discovery.json')):
    # Admitted developers persist here, so a lost or rebuilt snapshot cannot drop them.
    if not path.exists(): return []
    return [entry['login'] for entry in json.loads(path.read_text()).get('admitted', [])]
def get(url):
    # gh uses the user's existing keychain login; no token is written to the repo.
    endpoint = url.removeprefix('https://api.github.com/')
    result = subprocess.run(['gh', 'api', '--hostname', 'github.com', endpoint,
                             '-H', 'Accept: application/vnd.github+json',
                             '-H', 'X-GitHub-Api-Version: 2022-11-28'],
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError('GitHub API request failed for ' + endpoint.split('?')[0] + '; check gh auth status and gh api rate_limit')
    return json.loads(result.stdout)
QUERY = """
query($login: String!, $cursor: String) {
  user(login: $login) {
    databaseId login name avatarUrl url bio location
    followers { totalCount }
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: {field: STARGAZERS, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        databaseId name nameWithOwner url description homepageUrl
        stargazerCount forkCount isFork isArchived pushedAt createdAt
        primaryLanguage { name }
        licenseInfo { key name spdxId url }
        repositoryTopics(first: 25) { nodes { topic { name } } }
      }
    }
  }
}
"""
def graphql(variables):
    """One request returns a profile and 100 repositories, against GraphQL's
    own hourly allowance; the REST budget stays free for search."""
    command = ['gh', 'api', 'graphql', '-f', 'query=' + QUERY]
    for key, value in variables.items():
        if value is not None: command += ['-F', f'{key}={value}']
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    # gh exits non-zero when GraphQL reports errors, so read the body first:
    # a missing user is an organization or deleted account, not a failure.
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        payload = None
    if payload and payload.get('errors'):
        if any(error.get('type') == 'NOT_FOUND' for error in payload['errors']): return None
        raise RuntimeError('GitHub GraphQL error for ' + variables.get('login', '?') + ': ' + payload['errors'][0].get('message', 'unknown error'))
    if result.returncode or not payload:
        raise RuntimeError('GitHub GraphQL request failed for ' + variables.get('login', '?') + '; check gh auth status and gh api rate_limit')
    return payload['data']['user']
def shape(node):
    """Present a GraphQL repository the way the rest of the project expects."""
    licence = node.get('licenseInfo') or None
    return {'id': node['databaseId'], 'name': node['name'], 'full_name': node['nameWithOwner'],
            'html_url': node['url'], 'description': node['description'],
            'stargazers_count': node['stargazerCount'], 'forks_count': node['forkCount'],
            'language': (node.get('primaryLanguage') or {}).get('name'),
            'archived': node['isArchived'], 'pushed_at': node['pushedAt'], 'created_at': node['createdAt'],
            'license': licence and {'key': licence['key'], 'name': licence['name'], 'spdx_id': licence['spdxId'],
                                    'url': 'https://api.github.com/licenses/' + licence['key']},
            'topics': sorted(entry['topic']['name'] for entry in node['repositoryTopics']['nodes']),
            'homepage': node['homepageUrl'], 'fork': node['isFork']}
def collect(login, graph=None):
    # Callers with an API budget to respect pass their own counting request.
    graph = graph or graphql
    profile = graph({'login': login, 'cursor': None})
    if not profile: return None  # an organization or a deleted account
    repos=[shape(node) for node in profile['repositories']['nodes']]
    info=profile['repositories']['pageInfo']
    while info['hasNextPage']:
        following=graph({'login': login, 'cursor': info['endCursor']})
        repos.extend(shape(node) for node in following['repositories']['nodes'])
        info=following['repositories']['pageInfo']
    eligible=[r for r in repos if not r['fork'] and r.get('license') and r['license']['spdx_id'] not in ['NOASSERTION','NONE',None]]
    eligible.sort(key=lambda r:(-r['stargazers_count'], r['full_name']))
    result={'id':profile['databaseId'],'login':profile['login'],'name':profile['name'],
            # GraphQL adds a crop hash; keep the stable canonical avatar URL.
            'avatar_url':profile['avatarUrl'].split('?')[0]+'?v=4','html_url':profile['url'],'bio':profile['bio'] or None,
            'followers':profile['followers']['totalCount'],'location':profile['location']}
    result['repos']=[{k:r.get(k) for k in ['id','name','full_name','html_url','description','stargazers_count','forks_count','language','archived','pushed_at','license','topics','created_at','homepage']} for r in eligible]
    result['total_stars']=sum(r['stargazers_count'] for r in eligible)
    result['total_forks']=sum(r['forks_count'] for r in eligible)
    result['excluded_repos']=len(repos)-len(eligible)
    result['fetched_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(login,len(eligible),result['total_stars'],flush=True)
    return result

def save_history(snapshot, directory=pathlib.Path('data/history')):
    """Keep the first complete observation each UTC day, using immutable GitHub IDs.

    Counts are observations, not star events. Future growth calculations must
    compare the same repository IDs; changes in ownership/eligibility are separate.
    """
    if snapshot['errors']:
        raise ValueError('A partial refresh cannot become a historical baseline')
    observed_at = snapshot['fetched_at']
    day = observed_at[:10]
    developers = []
    for developer in snapshot['developers']:
        if not developer.get('id') or not developer.get('fetched_at', '').startswith(day):
            raise ValueError('History requires fresh, identified developer observations')
        repos = []
        for repo in developer['repos']:
            if not isinstance(repo.get('id'), int):
                raise ValueError('History requires immutable repository IDs')
            repos.append({key: repo[key] for key in ['id', 'full_name', 'stargazers_count', 'forks_count', 'archived', 'language']})
        developers.append({'id': developer['id'], 'login': developer['login'],
                           'observed_at': developer['fetched_at'],
                           'repos': sorted(repos, key=lambda r: r['id'])})
    payload = {'version': 1, 'observed_at': observed_at,
               'methodology': 'personal-public-nonfork-spdx-v1',
               'developers': sorted(developers, key=lambda d: d['id'])}
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / (day + '.json')
    # Publish the fully written file atomically without replacing an existing day.
    with tempfile.NamedTemporaryFile(mode='w', dir=directory, delete=False) as temporary:
        json.dump(payload, temporary, separators=(',', ':'))
        temporary_path = pathlib.Path(temporary.name)
    try:
        os.link(temporary_path, destination)
    except FileExistsError:
        return False
    finally:
        temporary_path.unlink()
    return True

if __name__=='__main__':
    import sys
    path=pathlib.Path('dist/data.json')
    existing=json.loads(path.read_text()) if path.exists() else {'developers':[]}
    results=existing['developers']; errors=[]
    for result in results: result.setdefault('fetched_at',existing.get('fetched_at'))
    retained={d['login'].lower() for d in results}
    candidates=list(dict.fromkeys(USERS + discovered() + [d['login'] for d in results]))
    pending=[u for u in candidates if '--refresh' in sys.argv or u.lower() not in retained]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(collect,u):u for u in pending}
        for future in concurrent.futures.as_completed(futures):
            try:
                value=future.result()
                if value:
                    results=[d for d in results if d['login'].lower()!=value['login'].lower()]
                    results.append(value)
            except Exception as e: errors.append({'login':futures[future],'error':str(e)}); print('ERROR',futures[future],str(e),flush=True)
    results.sort(key=lambda d:d['total_stars'],reverse=True)
    snapshot={'fetched_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'developers':results,'errors':errors}
    payload=json.dumps(snapshot)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as temporary:
        temporary.write(payload)
        temporary_path=temporary.name
    os.replace(temporary_path,path)
    print(f'Saved {len(results)} developers, {sum(len(d["repos"]) for d in results)} projects, {len(errors)} refresh errors')
    if errors: sys.exit(1)
    if '--refresh' in sys.argv:
        saved=save_history(snapshot)
        print('Saved daily historical baseline' if saved else 'Daily baseline already exists; preserved first observation')
