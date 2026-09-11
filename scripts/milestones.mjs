import { validate, compareObservations } from './competition.mjs';

const DAY = 86400000;
const date = value => new Date(value).toISOString().slice(0, 10);
export const thresholds = [10, 50, 100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
export function progress(stars) {
  const reached = thresholds.filter(n => n <= stars).at(-1) || 0;
  const next = thresholds.find(n => n > stars) || null;
  return { stars, reached, next, remaining: next === null ? null : next - stars, percent: next === null ? 100 : Math.floor(stars / next * 100) };
}
export function observations(history, snapshot) {
  // First complete observation per UTC day is the same policy used by the collector.
  const dates = new Set();
  return history.filter(validate).filter(h => Date.parse(h.observed_at) <= Date.parse(snapshot.fetched_at))
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)).filter(h => {
      const key = date(h.observed_at); if (dates.has(key)) return false; dates.add(key); return true;
    });
}

/** Only first observed crossings of a repository's lifetime observed high-water mark. */
export function milestoneEvents(history, snapshot) {
  const high = new Map(), events = [];
  const current = new Map(snapshot.developers.map(d => [d.id, d]));
  let previous = new Map();
  for (const observation of observations(history, snapshot)) {
    const next = new Map();
    for (const developer of observation.developers) for (const repo of developer.repos) {
      const last = previous.get(repo.id), seen = high.get(repo.id), owner = current.get(developer.id);
      if (last?.ownerId === developer.id && seen !== undefined && owner?.repos.some(r => r.id === repo.id)) {
        for (const threshold of thresholds) if (seen < threshold && repo.stargazers_count >= threshold) {
          const currentRepo = owner.repos.find(r => r.id === repo.id);
          events.push({ id: `milestone-${repo.id}-${threshold}`, developerId: developer.id, login: owner.login,
            repoId: repo.id, project: currentRepo.full_name, threshold, stars: repo.stargazers_count,
            from: last.observedAt, to: observation.observed_at,
            path: `/projects/${currentRepo.full_name.toLowerCase().split('/').map(encodeURIComponent).join('/')}/`,
            developerPath: `/developers/${encodeURIComponent(owner.login.toLowerCase())}/`,
            source: `https://github.com/${currentRepo.full_name}` });
        }
      }
      high.set(repo.id, Math.max(seen ?? 0, repo.stargazers_count));
      next.set(repo.id, { ownerId: developer.id, observedAt: observation.observed_at });
    }
    previous = next;
  }
  return events.sort((a, b) => b.to.localeCompare(a.to) || b.threshold - a.threshold || a.id.localeCompare(b.id));
}

export function completedPeriod(kind, asOf) {
  if (!['week', 'month'].includes(kind)) throw new Error('Unknown report period');
  const end = new Date(date(asOf) + 'T00:00:00Z');
  if (kind === 'week') end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7);
  else end.setUTCDate(1);
  const start = new Date(end);
  if (kind === 'week') start.setUTCDate(start.getUTCDate() - 7);
  else start.setUTCMonth(start.getUTCMonth() - 1);
  return { kind, startDate: date(start), endDate: date(end), labelEnd: date(end.getTime() - DAY),
    path: `/reports/${kind}/${date(start)}/` };
}
export function periodReport(period, history, snapshot) {
  const valid = observations(history, snapshot);
  const start = valid.find(h => date(h.observed_at) === period.startDate);
  const end = valid.find(h => date(h.observed_at) === period.endDate);
  const result = { ...period, status: 'collecting', entries: [], rising: [] };
  // Counts come from observation times on boundary dates, not invented midnight totals.
  if (!start || !end) return result;
  // A completed report keeps its endpoint cohort even if the live directory changes.
  const current = new Map(snapshot.developers.filter(d => d.repos.length).map(d => [d.id, d]));
  const cohort = { developers: end.developers.map(d => ({ ...d, name: current.get(d.id)?.name || d.login })) };
  const comparison = compareObservations(start, end, cohort);
  const link = entry => ({ ...entry, profilePath: current.has(entry.id) ? `/developers/${encodeURIComponent(current.get(entry.id).login.toLowerCase())}/` : `https://github.com/${encodeURIComponent(entry.login)}` });
  return { ...result, ...comparison, entries: comparison.entries.map(link), rising: comparison.rising.map(link) };
}
export function reports(history, snapshot, asOf) {
  const periods = new Map();
  for (const kind of ['week', 'month']) {
    for (const h of [...observations(history, snapshot), { observed_at: asOf }]) {
      const period = completedPeriod(kind, h.observed_at);
      periods.set(period.path, period);
    }
  }
  return [...periods.values()].map(p => periodReport(p, history, snapshot)).sort((a, b) => b.startDate.localeCompare(a.startDate) || a.kind.localeCompare(b.kind));
}

/** Stable daily rotation independent of portfolio size; each builder gets a turn. */
export function rotatingProfiles(profiles, asOf, count = 3) {
  const sorted = profiles.slice().sort((a, b) => a.id - b.id);
  if (!sorted.length) return [];
  const offset = Math.floor(Date.parse(date(asOf)) / DAY) * count % sorted.length;
  return Array.from({ length: Math.min(count, sorted.length) }, (_, i) => sorted[(offset + i) % sorted.length]);
}

/** Prepared items reserve a slot too; publishing is recorded separately by an operator. */
export function prepareAnnouncements(candidates, ledger, asOf, limit = 3) {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('Invalid preparation date');
  const known = new Set(ledger.map(item => item.id));
  const last = new Map();
  for (const item of ledger) if (item.developerId) last.set(item.developerId, Math.max(last.get(item.developerId) || 0, Date.parse(item.publishedAt || item.preparedAt)));
  const today = ledger.filter(item => date(item.preparedAt) === date(asOf)).length;
  const chosen = [];
  const seen = new Set();
  for (const card of candidates.slice().sort((a, b) => (last.get(a.developerId) || 0) - (last.get(b.developerId) || 0) || a.id.localeCompare(b.id))) {
    if (chosen.length >= Math.max(0, limit - today)) break;
    if (known.has(card.id) || (card.developerId && (seen.has(card.developerId) || Date.parse(asOf) - (last.get(card.developerId) || 0) < 7 * DAY))) continue;
    chosen.push({ ...card, status: 'prepared', preparedAt: asOf }); seen.add(card.developerId); known.add(card.id);
  }
  return chosen;
}
