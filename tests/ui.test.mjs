import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const snapshot = JSON.parse(read('dist/data.json'));
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
async function setup(configured = false, signedIn = false) {
  const dom = new JSDOM(read('dist/index.html'), { url: 'https://starboard.test', runScripts: 'outside-only' });
  const w = dom.window, d = snapshot.developers.find(d => d.repos.length);
  const calls = [];
  let saved = { claimed: false, claimsEnabled: configured };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.fetch = async (path, options = {}) => {
    calls.push([path, options]);
    let data = path === '/data.json' ? snapshot : path === '/api/config' ? { claimsEnabled: configured, publishableKey: 'pk_test_' + btoa('clerk.starboard.test$') } : saved;
    if (options.method === 'POST') saved = data = { claimed: true, bio: '', website: '', featuredProjects: [], claimsEnabled: true };
    if (options.method === 'PATCH') saved = data = { ...saved, ...JSON.parse(options.body) };
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => data };
  };
  w.TestClerk = class {
    user = signedIn ? { id: 'user_1', externalAccounts: [{ provider: 'github', providerUserId: String(d.id) }] } : null;
    session = signedIn ? { getToken: async () => 'test-token' } : null;
    async load() {}
    async signOut() { this.user = null; this.session = null; }
    addListener(fn) { fn({ user: this.user }); }
    openSignIn() { calls.push(['sign-in']); }
  };
  w.Clerk = new w.TestClerk();
  w.__internal_ClerkUICtor = class {};
  const append = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = script => { const result = append(script); if (script.tagName === 'SCRIPT') setTimeout(() => script.onload(), 0); return result; };
  w.eval(read('dist/enhancements.js') + '\n' + read('dist/app.js'));
  await tick();
  w.eval('(() => {\n' + read('src/claims.js').replace("import { Clerk } from '@clerk/clerk-js';", 'const Clerk = window.TestClerk;') + '\n})();');
  await tick();
  return { w, d, calls, document: w.document, close: () => dom.window.close() };
}
test('snapshot totals, search, and profile finder render using real data', async () => {
  const s = await setup();
  assert.equal(s.document.getElementById('developer-count').textContent, String(snapshot.developers.filter(d => d.repos.length).length));
  const search = s.document.getElementById('search'); search.value = 'nonexistent-profile-zzy'; search.dispatchEvent(new s.w.Event('input'));
  assert.match(s.document.getElementById('rows').textContent, /No matches/);
  s.document.getElementById('account-button').click();
  assert.equal(s.document.getElementById('claim-directory').open, true);
  assert.equal(s.document.querySelectorAll('#claim-usernames option').length, snapshot.developers.filter(d => d.repos.length).length);
  s.document.getElementById('claim-login').value = s.d.login;
  s.document.getElementById('find-profile-form').dispatchEvent(new s.w.Event('submit', { cancelable: true })); await tick();
  assert.equal(s.document.getElementById('profile-dialog').open, true);
  assert.match(s.document.getElementById('profile-claim').textContent, /coming soon/);
  assert.equal(s.document.querySelector('.claim-badge'), null);
  s.close();
});
test('configured signed-out visitor gets a sign-in action', async () => {
  const s = await setup(true);
  s.document.dispatchEvent(new s.w.CustomEvent('starboard:open-profile', { detail: s.d.login })); await tick();
  s.document.getElementById('profile-sign-in').click();
  assert.equal(s.document.getElementById('profile-dialog').open, false);
  assert.ok(s.calls.some(([path]) => path === 'sign-in'));
  s.close();
});
test('claim editor saves selected projects and escapes public bio', async () => {
  const s = await setup(true, true);
  s.document.dispatchEvent(new s.w.CustomEvent('starboard:open-profile', { detail: s.d.login })); await tick();
  s.document.getElementById('claim-profile').click(); await tick();
  const form = s.document.getElementById('profile-editor');
  form.querySelector('textarea').value = '<img src=x onerror=alert(1)> My projects';
  form.querySelector('[name=website]').value = 'https://example.com';
  form.querySelector('[name=featured]').checked = true;
  form.dispatchEvent(new s.w.Event('submit', { cancelable: true })); await tick();
  assert.match(s.document.getElementById('claim-status').textContent, /Profile saved/);
  assert.equal(s.document.querySelector('.curated-bio img'), null);
  assert.match(s.document.querySelector('.curated-bio').textContent, /<img/);
  assert.equal(s.document.querySelectorAll('.featured-projects a').length, 1);
  assert.equal(s.calls.find(([, opts]) => opts?.method === 'PATCH')[1].headers.Authorization, 'Bearer test-token');
  s.close();
});

test('sign-out clears account controls', async () => {
  const s = await setup(true, true);
  assert.equal(s.document.getElementById('sign-out').hidden, false);
  s.document.getElementById('sign-out').click(); await tick();
  assert.equal(s.document.getElementById('sign-out').hidden, true);
  assert.equal(s.document.getElementById('account-button').textContent, 'Claim your profile');
  s.close();
});
