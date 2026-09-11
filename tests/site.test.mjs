import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { generateSite, developerPath, projectPath, languageSlug, siteOrigin } from '../scripts/site.mjs';

const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const observed = '2026-09-11T16:00:00+00:00';
const snapshot = { fetched_at: observed, errors: [], developers: ['Alice', 'bob', 'carol'].map((login, n) => {
  const repos = Array.from({ length: 18 }, (_, i) => ({ id: n * 100 + i + 1, name: `Tool-${i}`, full_name: `${login}/Tool-${i}`, html_url: `https://github.com/${login}/Tool-${i}`, description: i ? 'A public tool' : '</script><img src=x onerror=alert(1)>', stargazers_count: 100 - i, forks_count: i, archived: i === 2, language: i === 17 ? 'Rare language' : 'Rust', license: { spdx_id: 'MIT' }, topics: ['cli'], created_at: '2020-01-01T00:00:00Z', pushed_at: observed, homepage: i ? null : 'javascript:alert(1)' }));
  return { id: n + 1, login, name: `${login} Developer`, bio: 'Building things <3', repos, total_stars: repos.reduce((sum, r) => sum + r.stargazers_count, 0), total_forks: repos.reduce((sum, r) => sum + r.forks_count, 0), followers: 123, avatar_url: 'https://avatars.githubusercontent.com/u/1', html_url: `https://github.com/${login}`, excluded_repos: 2, fetched_at: observed };
}) };

async function fixture(t, origin = 'https://starboard.example', history = []) {
  const outDir = await mkdtemp(join(tmpdir(), 'starboard-seo-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await generateSite({ snapshot: structuredClone(snapshot), history, template, outDir, origin });
  const read = route => readFile(join(outDir, route === '/404.html' ? '404.html' : route.slice(1) + 'index.html'), 'utf8');
  return { outDir, result, read };
}

test('all public pages contain crawlable facts, unique metadata, and working directory links without JS', async t => {
  const { result, read, outDir } = await fixture(t);
  const titles = new Set();
  for (const { path, index } of result.routes) {
    const dom = new JSDOM(await read(path)), doc = dom.window.document;
    assert.equal(doc.querySelectorAll('h1').length, 1, path);
    assert.equal(doc.querySelectorAll('title').length, 1, path);
    assert.equal(doc.querySelectorAll('meta[name=description]').length, 1, path);
    assert.ok(doc.querySelector('meta[name=description]').content.length > 20, path);
    assert.ok(!titles.has(doc.title), `duplicate title: ${doc.title}`); titles.add(doc.title);
    assert.equal(doc.querySelector('link[rel=canonical]').getAttribute('href'), 'https://starboard.example' + path);
    assert.equal(doc.querySelector('meta[name=robots]').content, index ? 'index,follow' : 'noindex,follow');
    assert.ok(doc.querySelector('main').textContent.trim().length > 100, path);
    for (const a of doc.querySelectorAll('a[href^="/"]')) {
      const href = a.getAttribute('href').split('#')[0];
      if (href === '/data.json') continue;
      assert.ok(result.routes.some(route => route.path === href), `${path}: orphan link ${href}`);
    }
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) assert.ok(JSON.parse(script.textContent)['@graph']);
    dom.window.close();
  }
  assert.equal(result.projects, 54);
  assert.equal(result.languages, 1, 'thin language collections are not generated');
  const sitemap = new JSDOM(await readFile(join(outDir, 'sitemap.xml'), 'utf8'), { contentType: 'application/xml' });
  const locations = [...sitemap.window.document.querySelectorAll('loc')].map(node => node.textContent);
  assert.equal(locations.length, result.routes.filter(route => route.index).length);
  assert.ok(locations.every(url => !url.includes('?') && !url.includes('#') && !url.includes('/trending/')));
  assert.ok(locations.includes('https://starboard.example/projects/page/2/'));
  sitemap.window.close();
  const home = new JSDOM(await read('/'));
  assert.equal(home.window.document.querySelectorAll('#rows tbody tr').length, 3);
  home.window.close();
});

test('complete weekly history makes real standings indexable while monthly collecting stays noindex', async t => {
  const history = ['2026-09-04', '2026-09-11'].map((day, i) => ({ version: 1, methodology: 'personal-public-nonfork-spdx-v1', observed_at: day + 'T16:00:00Z', developers: snapshot.developers.map(d => ({ id: d.id, login: d.login, observed_at: day + 'T15:59:00Z', repos: d.repos.map(r => ({ ...r, stargazers_count: r.stargazers_count - (i ? 0 : 2) })) })) }));
  const { read, outDir } = await fixture(t, 'https://starboard.example', history);
  const weekly = new JSDOM(await read('/trending/week/'));
  const doc = weekly.window.document;
  assert.equal(doc.querySelector('meta[name=robots]').content, 'index,follow');
  assert.equal(doc.querySelectorAll('.climb-list').length, 2);
  assert.match(doc.querySelector('.climb-gain').textContent, /\+36/);
  assert.equal(doc.querySelectorAll('.climb-rank').length, 6);
  assert.ok([...doc.querySelectorAll('.climb-rank')].every(node => node.textContent === '#1'));
  assert.match(doc.querySelector('.competition-period').textContent, /2026-09-04 → 2026-09-11/);
  weekly.window.close();
  const monthly = new JSDOM(await read('/trending/month/'));
  assert.equal(monthly.window.document.querySelector('meta[name=robots]').content, 'noindex,follow');
  assert.equal(monthly.window.document.querySelector('.climb-list'), null);
  monthly.window.close();
  const xml = await readFile(join(outDir, 'sitemap.xml'), 'utf8');
  assert.match(xml, /https:\/\/starboard.example\/trending\/week\//);
  assert.ok(!xml.includes('/trending/month/') && !xml.includes('/following/') && !xml.includes('/share/'));
});

test('profile and language totals reflect the actual matching repositories; unsafe data stays text', async t => {
  const { read } = await fixture(t);
  const profile = new JSDOM(await read('/developers/alice/'));
  const d = profile.window.document;
  const payload = JSON.parse(d.getElementById('page-data').textContent);
  assert.equal(payload.profile.id, 1);
  assert.equal(payload.profile.repos.length, 18);
  assert.match(d.querySelector('.page-stats').textContent, /1,647/);
  assert.match(d.querySelector('.projects').textContent, /<img src=x/);
  assert.equal(d.querySelector('[onerror]'), null);
  assert.equal(d.querySelectorAll('.projects .project').length, 18);
  profile.window.close();
  const project = new JSDOM(await read('/projects/alice/tool-0/'));
  assert.equal(project.window.document.querySelector('a[href^="javascript:"]'), null);
  assert.match(project.window.document.querySelector('main').textContent, /100/);
  project.window.close();
  const language = new JSDOM(await read('/languages/rust/'));
  assert.equal(language.window.document.querySelectorAll('.projects .project').length, 24);
  assert.equal(language.window.document.querySelectorAll('.compact-projects a').length, 27);
  assert.match(language.window.document.querySelector('.page-stats').textContent, /4,692/);
  language.window.close();
});

test('previews and missing pages are noindex; canonical origin configuration is explicit', async t => {
  const { read, outDir } = await fixture(t, null);
  for (const route of ['/', '/developers/alice/', '/404.html']) {
    const dom = new JSDOM(await read(route));
    assert.equal(dom.window.document.querySelector('meta[name=robots]').content, 'noindex,follow');
    assert.equal(dom.window.document.querySelector('link[rel=canonical]'), null);
    dom.window.close();
  }
  await assert.rejects(access(join(outDir, 'sitemap.xml')));
  assert.equal(siteOrigin('https://starboard.example/'), 'https://starboard.example');
  assert.throws(() => siteOrigin('http://starboard.example'));
  assert.throws(() => siteOrigin('https://starboard.example/preview'));
  assert.throws(() => siteOrigin('https://user:password@starboard.example'));
  assert.equal(developerPath('BurntSushi'), '/developers/burntsushi/');
  assert.equal(projectPath('Alice/Tool'), '/projects/alice/tool/');
  assert.notEqual(languageSlug('C++'), languageSlug('C#'));
});

test('homepage preserves its prerendered directory when the interactive snapshot request fails', async t => {
  const { read } = await fixture(t);
  const dom = new JSDOM(await read('/'), { url: 'https://starboard.example/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = async () => { throw new Error('Offline'); };
  dom.window.eval(await readFile(new URL('../dist/app.js', import.meta.url), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 0));
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('#rows tbody tr').length, 3);
  assert.match(doc.getElementById('result-count').textContent, /Showing the saved snapshot/);
  assert.equal(doc.getElementById('search').disabled, true);
  assert.equal(doc.querySelector('#rows a').getAttribute('href'), '/developers/alice/');
});

test('dedicated developer page initializes claiming and refreshes account state without a modal', async t => {
  const { read } = await fixture(t);
  const dom = new JSDOM(await read('/developers/alice/'), { url: 'https://starboard.example/developers/alice/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let profile = { claimed: false, claimsEnabled: true };
  w.fetch = async (path, options = {}) => {
    if (options.method === 'POST') profile = { claimed: true, claimsEnabled: true, bio: '', website: '', featuredProjects: [] };
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => path === '/api/config' ? { claimsEnabled: true, publishableKey: 'pk_test_' + btoa('clerk.starboard.example$') } : profile };
  };
  w.Clerk = { user: { id: 'u1', externalAccounts: [{ provider: 'github', providerUserId: '1' }] }, session: { getToken: async () => 'test' }, load: async () => {}, addListener(fn) { fn({ user: this.user }); }, async signOut() { this.user = null; this.session = null; } };
  const append = doc.head.appendChild.bind(doc.head);
  doc.head.appendChild = script => { const result = append(script); if (script.tagName === 'SCRIPT') setTimeout(() => script.onload(), 0); return result; };
  w.eval(await readFile(new URL('../dist/page.js', import.meta.url), 'utf8'));
  w.eval('(() => {\n' + await readFile(new URL('../src/claims.js', import.meta.url), 'utf8') + '\n})();');
  await tick();
  assert.equal(doc.querySelectorAll('#claim-usernames option').length, 3);
  doc.getElementById('claim-profile').click(); await tick();
  assert.ok(doc.getElementById('profile-editor'));
  doc.getElementById('sign-out').click(); await tick();
  assert.ok(doc.getElementById('profile-sign-in'));
  assert.equal(doc.getElementById('profile-editor'), null);
});
