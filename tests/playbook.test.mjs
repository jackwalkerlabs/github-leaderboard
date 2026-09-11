import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODOLOGY, engagementData } from '../scripts/competition.mjs';
import { progress, milestoneEvents, completedPeriod, periodReport, prepareAnnouncements, rotatingProfiles } from '../scripts/milestones.mjs';
import { socialPayload } from '../scripts/engagement-pages.mjs';
import { announcementHistory, milestonePage } from '../scripts/playbook-pages.mjs';
import { recordPublished, candidates } from '../scripts/announcements.mjs';
const repo = (id, stars) => ({ id, full_name: `builder/tool-${id}`, stargazers_count: stars });
const observe = (date, people) => ({ version: 1, methodology: METHODOLOGY, observed_at: date + 'T06:17:00Z', developers: people.map(([id, repos]) => ({ id, login: `builder${id}`, observed_at: date + 'T06:16:00Z', repos })) });
const snapshot = end => ({ fetched_at: end.observed_at, developers: end.developers.map(d => ({ ...d, total_stars: d.repos.reduce((n, r) => n + r.stargazers_count, 0) })) });

test('first baseline is not an achievement; later crossings are deduplicated across losses and transfers', () => {
  const history = [
    observe('2026-09-01', [[1, [repo(10, 90), repo(20, 500)]]]),
    observe('2026-09-02', [[1, [repo(10, 110), repo(20, 700), repo(30, 2000)]]]),
    observe('2026-09-03', [[1, [repo(10, 80), repo(20, 700)]], [2, [repo(30, 10000)]]]),
    observe('2026-09-04', [[1, [repo(10, 130), repo(20, 1000)]], [2, [repo(30, 12000)]]])
  ];
  assert.deepEqual(milestoneEvents([history[0]], snapshot(history[0])), []);
  const events = milestoneEvents(history, snapshot(history.at(-1)));
  assert.deepEqual(events.map(e => [e.repoId, e.threshold]), [[20, 1000], [10, 100]]);
  assert.equal(events[1].from, history[0].observed_at);
  assert.equal(events[1].to, history[1].observed_at);
  assert.equal(events[1].id, 'milestone-10-100');
  assert.equal(progress(98).remaining, 2);
  assert.equal(progress(100).next, 500);
  assert.equal(progress(1000001).next, null);
});
test('missing repository observations and invalid daily snapshots cannot invent a crossing', () => {
  const a = observe('2026-09-01', [[1, [repo(10, 9)]]]);
  const missing = observe('2026-09-02', [[1, []]]);
  const c = observe('2026-09-03', [[1, [repo(10, 100)]]]);
  assert.equal(milestoneEvents([a, missing, c], snapshot(c)).length, 0);
  assert.equal(milestoneEvents([{ ...a, methodology: 'different' }, c], snapshot(c)).length, 0);
  const duplicate = structuredClone(a); duplicate.developers[0].repos.push(repo(10, 0));
  assert.equal(milestoneEvents([duplicate, c], snapshot(c)).length, 0);
  const data = { ...engagementData(snapshot(c), [a, c], null), events: milestoneEvents([a, c], snapshot(c)) };
  assert.equal(socialPayload(data).cards.filter(c => c.key.startsWith('milestone-')).length, 3);
  assert.match(milestonePage([]).body, /Collecting history/);
});
test('completed periods respect Monday and month boundaries, including year and leap transitions', () => {
  assert.deepEqual(completedPeriod('week', '2026-09-11T19:00:00Z'), { kind: 'week', startDate: '2026-08-31', endDate: '2026-09-07', labelEnd: '2026-09-06', path: '/reports/week/2026-08-31/' });
  assert.equal(completedPeriod('month', '2026-01-01T00:00:00Z').startDate, '2025-12-01');
  assert.equal(completedPeriod('month', '2024-03-01T00:00:00Z').labelEnd, '2024-02-29');
  const a = observe('2026-08-31', [[1, [repo(10, 90)]]]), b = observe('2026-09-07', [[1, [repo(10, 110), repo(20, 50000)]]]);
  const period = completedPeriod('week', b.observed_at);
  const report = periodReport(period, [a, b], snapshot(b));
  assert.equal(report.entries[0].gain, 20);
  assert.equal(report.startObservedAt, a.observed_at);
  const archived = periodReport(period, [a, b], { ...snapshot(b), developers: [] });
  assert.equal(archived.entries[0].gain, 20, 'completed standings survive changes to the current directory');
  assert.equal(archived.entries[0].profilePath, 'https://github.com/builder1');
  assert.equal(periodReport(period, [b], snapshot(b)).status, 'collecting');
});
test('daily exposure rotates independently of stars and draft preparation is fair and idempotent', () => {
  const profiles = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, stars: 100000 / (i + 1) }));
  assert.equal(new Set([1, 2, 3].flatMap(day => rotatingProfiles(profiles, `2026-09-0${day}`).map(p => p.id))).size, 9);
  const rows = profiles.flatMap(p => [{ id: `event-a-${p.id}`, developerId: p.id }, { id: `event-b-${p.id}`, developerId: p.id }]);
  const now = '2026-09-11T12:00:00Z';
  const first = prepareAnnouncements(rows, [], now);
  assert.equal(first.length, 3); assert.equal(new Set(first.map(r => r.developerId)).size, 3);
  assert.deepEqual(prepareAnnouncements(rows, first, now), []);
  const second = prepareAnnouncements(rows, first, '2026-09-12T12:00:00Z');
  assert.ok(second.every(row => !first.some(old => old.developerId === row.developerId)));
  assert.ok(first.every(row => row.status === 'prepared' && !row.postUrl));
  assert.ok(!announcementHistory(first).body.includes('Read published post'));
  const published = recordPublished(first, first[0].id, 'https://x.com/starboard/status/12345', now);
  assert.match(announcementHistory(published).body, /Read published post/);
  assert.deepEqual(recordPublished(published, first[0].id, published[0].postUrl, now), published);
  assert.throws(() => recordPublished(first, first[0].id, 'javascript:alert(1)', now));
  assert.throws(() => recordPublished(first, 'unknown', 'https://x.com/starboard/status/12345', now));
});
test('stale snapshots produce no promotional spotlights and every prepared candidate credits its source', () => {
  const end = observe('2026-09-01', [[1, [repo(10, 100)]]]);
  assert.deepEqual(candidates(snapshot(end), [end], 'https://starboard.test', '2026-09-20T12:00:00Z'), []);
  const cards = candidates(snapshot(end), [end], 'https://starboard.test', end.observed_at);
  assert.match(cards[0].text, /https:\/\/starboard.test\/developers\/builder1\//);
  assert.match(cards[0].text, /Source: https:\/\/github.com\/builder1/);
});
