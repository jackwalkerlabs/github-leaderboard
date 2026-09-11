import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createWorker } from '../worker/index.js';
import { HttpError } from '../worker/claims.js';
const developer = { id: 123, login: 'alice', repos: [{ full_name: 'alice/tool' }] };
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_claims.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_portfolios.sql', import.meta.url), 'utf8'));
  const owner = { id: 'user_1', externalAccounts: [{ provider: 'oauth_github', providerUserId: '123', verification: { status: 'verified' } }] };
  let user = owner;
  const env = {
    CLERK_PUBLISHABLE_KEY: 'configured', CLERK_SECRET_KEY: 'secret', APP_ORIGIN: 'https://starboard.test',
    DB: { prepare(sql) { return { bind(...args) { return { first: async () => db.prepare(sql).get(...args) ?? null, run: async () => db.prepare(sql).run(...args) }; } }; } },
    ASSETS: { fetch: async () => Response.json({ developers: [developer] }) }
  };
  const worker = createWorker({ getUser: async request => {
    if (!request.headers.has('Authorization')) throw new HttpError(401, 'Sign in');
    return user;
  } });
  return { env, db, setUser(value) { user = value; }, owner,
    async call(method = 'GET', body, extra = {}) {
      const headers = { Origin: env.APP_ORIGIN, Authorization: 'Bearer test', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra };
      for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
      const response = await worker.fetch(new Request('https://starboard.test/api/profiles/alice', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      return { status: response.status, body: await response.json() };
    }
  };
}
test('public reads work without a session and never expose Clerk IDs', async () => {
  const s = setup(); await s.call('POST');
  const result = await s.call('GET', undefined, { Authorization: null });
  assert.equal(result.status, 200); assert.equal(result.body.claimed, true);
  assert.ok(!JSON.stringify(result.body).includes('user_1'));
});
test('anonymous and cross-origin claims are rejected', async () => {
  const s = setup();
  assert.equal((await s.call('POST', undefined, { Authorization: null })).status, 401);
  assert.equal((await s.call('POST', undefined, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await s.call('POST', undefined, { Origin: null })).status, 403);
});
test('GitHub numeric ID must match and connection must be verified', async () => {
  const s = setup();
  s.setUser({ id: 'imposter', externalAccounts: [{ provider: 'github', username: 'alice', providerUserId: '999', verification: { status: 'verified' } }] });
  assert.equal((await s.call('POST')).status, 403);
  s.setUser({ ...s.owner, externalAccounts: [{ ...s.owner.externalAccounts[0], verification: { status: 'unverified' } }] });
  assert.equal((await s.call('POST')).status, 403);
  s.setUser({ ...s.owner, externalAccounts: [{ ...s.owner.externalAccounts[0], provider: 'google' }] });
  assert.equal((await s.call('POST')).status, 403);
});
test('claim is idempotent, and another Clerk user cannot take it over', async () => {
  const s = setup();
  assert.equal((await s.call('POST')).status, 200);
  assert.equal((await s.call('POST')).status, 200);
  s.setUser({ ...s.owner, id: 'user_2' });
  assert.equal((await s.call('POST')).status, 409);
  assert.equal((await s.call('PATCH', { bio: '', website: '', featuredProjects: [] })).status, 403);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM profile_claims').get().n, 1);
});
test('a Clerk user cannot claim multiple GitHub identities', async () => {
  const s = setup();
  s.db.prepare('INSERT INTO profile_claims (github_user_id, clerk_user_id) VALUES (?, ?)').run('456', s.owner.id);
  assert.equal((await s.call('POST')).status, 409);
});
test('owner edits persist, including clearing fields', async () => {
  const s = setup(); await s.call('POST');
  const edits = { bio: '  I build tools.  ', story: '  A longer builder story.\nWith a second paragraph.  ', website: 'https://example.com', featuredProjects: ['alice/tool'] };
  assert.equal((await s.call('PATCH', edits)).status, 200);
  const saved = (await s.call()).body;
  assert.equal(saved.bio, 'I build tools.'); assert.equal(saved.story, edits.story.trim()); assert.deepEqual(saved.featuredProjects, ['alice/tool']);
  assert.equal((await s.call('PATCH', { bio: '', website: '', featuredProjects: [] })).status, 200);
  assert.equal((await s.call()).body.website, '');
});
test('edit rejects forged stats, unsafe URLs, duplicate or foreign repositories', async () => {
  const s = setup(); await s.call('POST');
  const base = { bio: '', website: '', featuredProjects: [] };
  for (const body of [
    { ...base, stars: 100000 }, { ...base, githubUserId: '999' },
    { ...base, website: 'javascript:alert(1)' }, { ...base, website: 'https://user:pass@example.com' },
    { ...base, featuredProjects: ['other/repo'] }, { ...base, featuredProjects: ['alice/tool', 'alice/tool'] },
    { ...base, bio: 'a'.repeat(301) }, { ...base, story: 'a'.repeat(2001) }, { ...base, story: {} }, { ...base, featuredProjects: 'alice/tool' }, null
  ]) assert.equal((await s.call('PATCH', body)).status, 400);
});
test('unlinking GitHub removes edit access', async () => {
  const s = setup(); await s.call('POST'); s.setUser({ id: s.owner.id, externalAccounts: [] });
  assert.equal((await s.call('PATCH', { bio: '', website: '', featuredProjects: [] })).status, 403);
});
test('unconfigured preview does not allow claims', async () => {
  const s = setup(); delete s.env.CLERK_SECRET_KEY;
  assert.equal((await s.call('POST')).status, 503);
  assert.equal((await s.call()).body.claimsEnabled, false);
});
