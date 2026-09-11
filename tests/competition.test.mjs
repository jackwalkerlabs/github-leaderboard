import test from 'node:test';
import assert from 'node:assert/strict';
import { competition, engagementData, rankEntries, METHODOLOGY } from '../scripts/competition.mjs';
import { growthCard, storiesPage } from '../scripts/engagement-pages.mjs';

const repo = (id, stars) => ({ id, full_name: `owner/project-${id}`, stargazers_count: stars });
const observation = (date, people) => ({ version: 1, methodology: METHODOLOGY, observed_at: date + 'T12:00:00Z', developers: people.map(([id, repos]) => ({ id, login: `person-${id}`, observed_at: date + 'T11:58:00Z', repos })) });
const snapshot = end => ({ fetched_at: end.observed_at, developers: end.developers.map(d => ({ ...d, name: d.login, fetched_at: d.observed_at, total_stars: d.repos.reduce((n, repo) => n + repo.stargazers_count, 0) })) });

test('growth follows stable repo IDs and owners; additions, removals, transfers and new entrants do not inflate scores', () => {
  const before = observation('2026-09-01', [[1, [repo(11, 100), repo(12, 9000)]], [2, [repo(21, 50)]], [3, [repo(31, 20000)]]]);
  const after = observation('2026-09-08', [[1, [{ ...repo(11, 120), full_name: 'person-1/renamed' }, repo(13, 500000), repo(21, 5000)]], [2, [repo(22, 100000)]], [3, [repo(31, 19990)]], [4, [repo(41, 300000)]]]);
  const result = competition([before, after], 7, snapshot(after));
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.entries.map(d => [d.id, d.gain]), [[1, 20], [3, -10]]);
  assert.equal(result.entries[0].matched, 1);
  assert.equal(result.entries[0].added, 2);
  assert.equal(result.entries[0].removed, 1);
  assert.deepEqual(result.rising.map(d => d.id), [1], 'league membership uses the starting portfolio, not current stars');
  assert.equal(result.excludedDevelopers, 2);
  assert.equal(result.entries[1].toNextRank, 31);
});

test('ties share rank, and gaps describe the stars needed to pass a higher score', () => {
  const entries = rankEntries([{ id: 1, login: 'z', gain: 20 }, { id: 2, login: 'a', gain: 20 }, { id: 3, login: 'b', gain: 5 }]);
  assert.deepEqual(entries.map(d => [d.login, d.rank, d.toNextRank]), [['a', 1, null], ['z', 1, null], ['b', 3, 16]]);
});

test('missing, incompatible or invalid observations cannot produce a score; stale results stay out of the active climb', () => {
  const before = observation('2026-09-01', [[1, [repo(11, 100)]]]);
  const after = observation('2026-09-08', [[1, [repo(11, 120)]]]);
  const current = snapshot(after);
  assert.equal(competition([after], 7, current).status, 'collecting');
  assert.equal(competition([{ ...before, methodology: 'other-rules' }, after], 7, current).status, 'collecting');
  const duplicated = structuredClone(before); duplicated.developers[0].repos.push(repo(11, 100000));
  assert.equal(competition([duplicated, after], 7, current).status, 'collecting');
  assert.equal(competition([before, after], 30, current).status, 'collecting');
  assert.equal(competition([before, after], 7, { ...current, fetched_at: '2026-09-12T00:00:00Z' }).status, 'stale');
  assert.equal(competition([before, after], 7, current, '2026-09-12T00:00:00Z').status, 'stale', 'an old snapshot also becomes stale when rebuilding later');
  assert.equal(competition([], 7, current).observations, 0);
  assert.throws(() => competition([], 1, current));
});

test('monthly rankings use 30-day observations and share drafts carry the actual scope and dates', () => {
  const before = observation('2026-09-01', [[1, [repo(11, 100)]]]);
  const after = observation('2026-10-01', [[1, [repo(11, 130)]]]);
  const result = competition([before, after], 30, snapshot(after));
  assert.equal(result.status, 'ready');
  assert.equal(result.entries[0].gain, 30);
  const card = growthCard(result.entries[0], result, 'rising');
  assert.match(card.text, /monthly Rising builders/);
  assert.match(card.text, /2026-09-01–2026-10-01 · Curated sample/);
  assert.match(card.scope, /30-day net stars/);
  assert.equal(card.path, '/trending/month/#rising');
  assert.ok(!card.text.includes('@person'), 'GitHub usernames must not be assumed to be X handles');
});

test('all-time cards respect tied ranks; stories never invent positive progress from missing or zero growth', () => {
  const before = observation('2026-09-01', [[1, [repo(11, 100)]], [2, [repo(21, 100)]]]);
  const after = observation('2026-09-08', [[1, [repo(11, 100)]], [2, [repo(21, 100)]]]);
  const data = engagementData(snapshot(after), [before, after], null);
  assert.deepEqual(data.profiles.map(d => d.rank), [1, 1]);
  assert.ok(!storiesPage(data).body.includes('LEADERBOARD UPDATE'));
  assert.ok(storiesPage(data).body.includes('DEVELOPER SPOTLIGHT'));
});
