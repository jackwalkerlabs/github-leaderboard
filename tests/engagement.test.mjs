import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { engagementData } from '../scripts/competition.mjs';
import { socialPayload } from '../scripts/engagement-pages.mjs';

const script = await readFile(new URL('../dist/engagement.js', import.meta.url), 'utf8');
const snapshot = { fetched_at: '2026-09-11T12:00:00Z', developers: [
  { id: 1, login: 'alice', name: '<img src=x onerror=alert(1)>', repos: [{ id: 11, stargazers_count: 100 }], total_stars: 100 },
  { id: 2, login: 'bob', name: 'Bob', repos: [{ id: 21, stargazers_count: 90 }], total_stars: 90 }
] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(t, { origin = 'https://starboard.example', following = [], list = false, onlyAlice = false, blockedStorage = false } = {}) {
  const data = engagementData(snapshot, [], origin);
  const payload = socialPayload(data, onlyAlice ? data.profiles.slice(0, 1) : data.profiles);
  const html = `<main class="competition-profile">${list ? '<div id="following-list"></div>' : '<button data-follow-id="1" hidden>Follow</button><button data-share-key="profile-1" hidden>Share update</button>'}</main><script id="engagement-data" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`;
  const dom = new JSDOM(html, { url: origin || 'http://localhost:8792', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document, copied = [], downloads = [];
  w.localStorage.setItem('starboard-following-v1', JSON.stringify(following));
  if (blockedStorage) w.Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text); } } });
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {}, measureText: text => ({ width: text.length * 10 }) });
  w.HTMLCanvasElement.prototype.toBlob = function (callback, type) { downloads.push({ width: this.width, height: this.height, type }); callback(new w.Blob(['test-png'], { type })); };
  w.URL.createObjectURL = () => 'blob:test-card'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, href: this.href }); };
  w.eval(script);
  return { w, doc, copied, downloads };
}

test('following persists by GitHub ID and survives reload without losing builders not on the current page', t => {
  const first = setup(t, { following: [2], onlyAlice: true });
  first.doc.querySelector('[data-follow-id="1"]').click();
  assert.equal(first.doc.querySelector('[data-follow-id="1"]').getAttribute('aria-pressed'), 'true');
  const saved = JSON.parse(first.w.localStorage.getItem('starboard-following-v1'));
  assert.deepEqual(saved, [2, 1]);
  const next = setup(t, { following: saved, list: true });
  assert.equal(next.doc.querySelectorAll('.following-card').length, 2);
  assert.equal(next.doc.querySelector('.following-card [onerror]'), null);
  assert.match(next.doc.querySelector('.following-card h2').textContent, /<img/);
  next.doc.querySelector('[data-follow-id="1"]').click();
  assert.equal(next.doc.querySelectorAll('.following-card').length, 1);
  assert.deepEqual(JSON.parse(next.w.localStorage.getItem('starboard-following-v1')), [2]);
});

test('blocked storage never pretends a follow was saved', t => {
  const s = setup(t, { blockedStorage: true });
  s.doc.querySelector('[data-follow-id]').click();
  assert.equal(s.doc.querySelector('[data-follow-id]').getAttribute('aria-pressed'), 'false');
  assert.match(s.doc.getElementById('following-status').textContent, /could not save/);
});

test('share opens an editable, dated, scoped draft and copies the configured public URL', async t => {
  const s = setup(t);
  s.doc.querySelector('[data-share-key]').click();
  assert.equal(s.doc.getElementById('share-dialog').open, true);
  assert.equal(s.doc.getElementById('card-rank').textContent, '#1');
  assert.match(s.doc.getElementById('card-scope').textContent, /curated sample/);
  assert.equal(s.doc.getElementById('card-date').textContent, '2026-09-11');
  const input = s.doc.getElementById('share-text');
  input.value = 'Useful open source & real progress'; input.dispatchEvent(new s.w.Event('input'));
  const intent = new URL(s.doc.getElementById('share-on-x').href);
  assert.equal(intent.origin, 'https://twitter.com');
  assert.equal(intent.pathname, '/intent/tweet');
  assert.equal(intent.searchParams.get('text'), input.value);
  assert.equal(intent.searchParams.get('url'), 'https://starboard.example/developers/alice/');
  s.doc.getElementById('copy-share').click(); await tick();
  assert.deepEqual(s.copied, ['Useful open source & real progress\nhttps://starboard.example/developers/alice/']);
  s.doc.getElementById('download-share').click(); await tick();
  assert.deepEqual(s.downloads[0], { width: 1200, height: 630, type: 'image/png' });
  assert.match(s.downloads[1].filename, /starboard-profile-1-2026-09-11\.png/);
  assert.equal(s.doc.getElementById('download-share').disabled, false);
});

test('local previews never put localhost into a public post draft', async t => {
  const s = setup(t, { origin: null });
  s.doc.querySelector('[data-share-key]').click();
  assert.equal(s.doc.getElementById('share-on-x').hidden, true);
  assert.match(s.doc.getElementById('share-preview-note').textContent, /Preview/);
  s.doc.getElementById('copy-share').click(); await tick();
  assert.ok(!s.copied[0].includes('localhost'));
  assert.match(s.copied[0], /all-time stars/);
});

test('following updates across tabs and an empty list gives a route back to discovery', t => {
  const s = setup(t, { list: true });
  assert.match(s.doc.getElementById('following-list').textContent, /Who are you rooting for/);
  s.w.localStorage.setItem('starboard-following-v1', '[2]');
  s.w.dispatchEvent(new s.w.StorageEvent('storage', { key: 'starboard-following-v1' }));
  assert.equal(s.doc.querySelectorAll('.following-card').length, 1);
  assert.match(s.doc.querySelector('.following-card').textContent, /Bob/);
});
