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
// Cloudflare's edge can serve the previous asset for a few seconds after a
// deploy, so poll a cache-busted URL rather than judging on the first answer.
let served = null;
for (let attempt = 0; attempt < 10; attempt++) {
  const response = await fetch(`${base}/data.json?deploy-check=${Date.now()}`, { cache: 'no-store' });
  if (response.ok) {
    served = await response.json();
    if (served.fetched_at === snapshot.fetched_at) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 6000));
}
if (!served) {
  failures.push('Deployed site never served /data.json.');
} else if (served.fetched_at !== snapshot.fetched_at) {
  failures.push(`Deployed snapshot is still ${served.fetched_at} after waiting; expected ${snapshot.fetched_at}.`);
}

if (failures.length) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}
console.log(`Smoke test passed against ${base} (snapshot ${snapshot.fetched_at}).`);
