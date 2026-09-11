import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { joinPage } from '../scripts/playbook-pages.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
async function setup(t, enabled, signedIn = false, fail = false) {
  const dom = new JSDOM(read('dist/index.html'), { url: 'https://starboard.test/join/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document, calls = [];
  doc.querySelector('main').insertAdjacentHTML('beforeend', joinPage().body);
  w.starboardDevelopers = [{ login: 'alice', name: 'Alice' }];
  w.fetch = async (path, options = {}) => {
    calls.push({ path, ...options });
    return { ok: path === '/api/config' || !fail, headers: { get: () => 'application/json' }, json: async () => path === '/api/config' ? { claimsEnabled: enabled, publishableKey: 'pk_test_' + btoa('clerk.starboard.test$') } : fail ? { error: 'GitHub is unavailable. Try again later.' } : { status: 'requested', login: 'connected-owner' } };
  };
  w.Clerk = { user: signedIn ? { id: 'one', externalAccounts: [{ provider: 'github', providerUserId: '123' }] } : null, session: signedIn ? { getToken: async () => 'test-session' } : null, load: async () => {}, addListener: () => {}, openSignIn: options => calls.push({ signIn: options }) };
  const append = doc.head.appendChild.bind(doc.head);
  doc.head.appendChild = script => { const result = append(script); if (script.tagName === 'SCRIPT') setTimeout(() => script.onload(), 0); return result; };
  w.eval(read('src/claims.js')); await tick();
  return { w, doc, calls, submit(login) { doc.getElementById('join-login').value = login; doc.getElementById('join-form').dispatchEvent(new w.Event('submit', { cancelable: true })); } };
}
test('known builder opens their portfolio; an unconfigured unknown builder gets an honest next step', async t => {
  const s = await setup(t, false); let opened;
  s.doc.addEventListener('starboard:open-profile', e => { opened = e.detail; });
  s.submit('ALICE'); assert.equal(opened, 'alice');
  s.submit('new-builder');
  assert.match(s.doc.getElementById('join-status').textContent, /requests open when GitHub sign-in is available/);
  assert.equal(s.doc.getElementById('join-request').hidden, true);
  assert.equal(s.calls.filter(c => c.path === '/api/listing-request').length, 0);
});
test('new-builder sign-in returns to onboarding instead of a nonexistent developer URL', async t => {
  const s = await setup(t, true); s.submit('new-builder'); s.doc.getElementById('join-request').click();
  const options = s.calls.find(c => c.signIn).signIn;
  assert.equal(options.forceRedirectUrl, 'https://starboard.test/join/?login=new-builder');
  assert.equal(options.signUpForceRedirectUrl, options.forceRedirectUrl, 'first-time GitHub users must return to onboarding too');
});
test('verified listing submission describes the actual connected account and remains a request', async t => {
  const s = await setup(t, true, true); s.submit('typed-name'); s.doc.getElementById('join-request').click(); await tick();
  assert.equal(s.calls.find(c => c.path === '/api/listing-request').headers.Authorization, 'Bearer test-session');
  assert.match(s.doc.getElementById('join-status').textContent, /Listing requested for connected-owner/);
  assert.match(s.doc.getElementById('join-status').textContent, /eligibility review and import/);
  assert.equal(s.doc.getElementById('join-request').hidden, true);
});
test('failed admission does not pretend a request was saved and allows retry', async t => {
  const s = await setup(t, true, true, true); s.submit('new-builder'); s.doc.getElementById('join-request').click(); await tick();
  assert.match(s.doc.getElementById('join-status').textContent, /GitHub is unavailable/);
  assert.equal(s.doc.getElementById('join-request').disabled, false);
  assert.equal(s.doc.getElementById('join-request').hidden, false);
});
