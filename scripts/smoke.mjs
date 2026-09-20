// Post-deploy check that the public site serves the snapshot we just built.
// Route coverage is deliberately small: one page of each generated kind, plus
// the crawler files and a real 404, so a broken build cannot deploy silently.
import { readFile } from 'node:fs/promises';

const base = (process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
if (!base) throw new Error('Set SMOKE_BASE_URL to the deployed origin.');

const failures = [];

async function get(path, { expect = 200 } = {}) {
  const response = await fetch(`${base}${path}`, { redirect: 'follow' });
  if (response.status !== expect) {
    failures.push(`${path} responded ${response.status}, expected ${expect}`);
    return null;
  }
  return response;
}

const snapshot = JSON.parse(await readFile(new URL('../dist/data.json', import.meta.url), 'utf8'));
const developer = snapshot.developers[0]?.login;
const project = snapshot.developers[0]?.repos?.[0]?.full_name;

for (const path of ['/', '/developers/', '/milestones/', '/join/', '/trending/week/', '/robots.txt', '/sitemap.xml']) {
  await get(path);
}
if (developer) await get(`/developers/${developer}/`);
if (project) await get(`/projects/${project}/`);
await get('/this-page-does-not-exist/', { expect: 404 });

const home = await get('/');
if (home && !(await home.text()).includes('Repo League')) {
  failures.push('Homepage does not mention Repo League.');
}

// The deployed snapshot must match the one this run built, not an earlier one.
const live = await get('/data.json');
if (live) {
  const served = await live.json();
  if (served.fetched_at !== snapshot.fetched_at) {
    failures.push(`Deployed snapshot is ${served.fetched_at}, expected ${snapshot.fetched_at}.`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}
console.log(`Smoke test passed against ${base} (snapshot ${snapshot.fetched_at}).`);
