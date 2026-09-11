const DAY = 86400000;
export const METHODOLOGY = 'personal-public-nonfork-spdx-v1';
const day = value => new Date(value).toISOString().slice(0, 10);
const dateBefore = (value, days) => day(Date.parse(value.slice(0, 10) + 'T00:00:00Z') - days * DAY);

export function validate(observation) {
  if (observation.version !== 1 || observation.methodology !== METHODOLOGY || !Number.isFinite(Date.parse(observation.observed_at))) return false;
  const users = new Set(), repos = new Set();
  if (!Array.isArray(observation.developers)) return false;
  return observation.developers.every(person => {
    if (!Number.isSafeInteger(person.id) || users.has(person.id) || !Array.isArray(person.repos) || !Number.isFinite(Date.parse(person.observed_at))) return false;
    users.add(person.id);
    if (day(person.observed_at) !== day(observation.observed_at)) return false;
    return person.repos.every(repo => {
      if (!Number.isSafeInteger(repo.id) || repos.has(repo.id) || !Number.isSafeInteger(repo.stargazers_count) || repo.stargazers_count < 0) return false;
      repos.add(repo.id); return true;
    });
  });
}

export function rankEntries(entries) {
  const sorted = entries.slice().sort((a, b) => b.gain - a.gain || a.login.localeCompare(b.login));
  return sorted.map((entry, i) => {
    const rank = sorted.findIndex(other => other.gain === entry.gain) + 1;
    const ahead = sorted.slice(0, i).reverse().find(other => other.gain > entry.gain);
    return { ...entry, rank, toNextRank: ahead ? ahead.gain - entry.gain + 1 : null };
  });
}

/** Compare exact UTC observation dates and stable repo ownership, never portfolio totals. */
export function competition(history, days, snapshot, asOf = snapshot.fetched_at) {
  if (![7, 30].includes(days)) throw new Error('Only 7-day and 30-day competitions are supported');
  const valid = history.filter(validate).filter(item => Date.parse(item.observed_at) <= Date.parse(snapshot.fetched_at)).sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const end = valid.at(-1);
  const result = { days, status: 'collecting', observations: new Set(valid.map(item => day(item.observed_at))).size, firstDate: valid.length ? day(valid[0].observed_at) : null, endDate: end ? day(end.observed_at) : null, baselineDate: end ? dateBefore(end.observed_at, days) : null, entries: [], rising: [], excludedDevelopers: 0 };
  if (!end) return result;
  const start = valid.find(item => day(item.observed_at) === result.baselineDate);
  if (!start) return result;
  // A stale observation never presents itself as a current competition.
  if (Date.parse(asOf) - Date.parse(end.observed_at) > 2 * DAY) return { ...result, status: 'stale' };
  return { ...result, ...compareObservations(start, end, snapshot) };
}

export function compareObservations(start, end, snapshot) {
  const known = new Map(snapshot.developers.filter(d => d.repos.length).map(d => [d.id, d]));
  const baseline = new Map(start.developers.map(d => [d.id, d]));
  const entries = [];
  for (const current of end.developers) {
    const previous = baseline.get(current.id), developer = known.get(current.id);
    if (!previous || !developer) continue;
    const before = new Map(previous.repos.map(repo => [repo.id, repo]));
    const matched = current.repos.filter(repo => before.has(repo.id));
    if (!matched.length) continue;
    const gain = matched.reduce((sum, repo) => sum + repo.stargazers_count - before.get(repo.id).stargazers_count, 0);
    entries.push({ id: current.id, login: developer.login, name: developer.name || developer.login, gain,
      matched: matched.length, added: current.repos.length - matched.length, removed: previous.repos.length - matched.length,
      baselineStars: previous.repos.reduce((sum, repo) => sum + repo.stargazers_count, 0) });
  }
  return { status: entries.length ? 'ready' : 'collecting', startObservedAt: start.observed_at, endObservedAt: end.observed_at,
    entries: rankEntries(entries), rising: rankEntries(entries.filter(entry => entry.baselineStars < 10000)),
    excludedDevelopers: known.size - entries.length };
}

export function engagementData(snapshot, history, origin, asOf = snapshot.fetched_at) {
  const week = competition(history, 7, snapshot, asOf), month = competition(history, 30, snapshot, asOf);
  const developers = snapshot.developers.filter(d => d.repos.length).slice().sort((a, b) => b.total_stars - a.total_stars || a.login.localeCompare(b.login));
  const profiles = developers.map(d => ({ id: d.id, login: d.login, name: d.name || d.login,
    stars: d.total_stars, projects: d.repos.length,
    rank: developers.findIndex(other => other.total_stars === d.total_stars) + 1,
    path: `/developers/${encodeURIComponent(d.login.toLowerCase())}/`, observedAt: d.fetched_at || snapshot.fetched_at,
    weekly: week.entries.find(entry => entry.id === d.id) || null, monthly: month.entries.find(entry => entry.id === d.id) || null }));
  return { origin, observedAt: snapshot.fetched_at, sampleSize: profiles.length, profiles, week, month };
}
