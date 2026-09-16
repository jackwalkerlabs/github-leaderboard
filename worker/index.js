import { listingRequest } from './listings.js';
import { createClerkClient } from '@clerk/backend';
import { HttpError, requireGitHubOwner, validateEdits, publicClaim } from './claims.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function authenticate(request, env) {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });
  // Only session tokens from our frontend may authorize a profile mutation.
  const state = await clerk.authenticateRequest(request, { authorizedParties: [env.APP_ORIGIN], acceptsToken: 'session_token' });
  const auth = state.toAuth();
  if (!state.isAuthenticated || !auth?.userId) throw new HttpError(401, 'Sign in to claim or edit your profile.');
  return clerk.users.getUser(auth.userId);
}
export function createWorker({ getUser = authenticate, githubFetch = fetch } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      try {
        const configured = Boolean(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY && env.APP_ORIGIN && env.DB);
        if (url.pathname === '/api/config' && request.method === 'GET') {
          return json({ claimsEnabled: configured, publishableKey: configured ? env.CLERK_PUBLISHABLE_KEY : null });
        }
        if (url.pathname === '/api/listing-request') return json(await listingRequest(request, env, getUser, githubFetch));
        const match = url.pathname.match(/^\/api\/profiles\/([a-z\d](?:[a-z\d-]{0,38}))$/i);
        if (!match) throw new HttpError(404, 'Page not found.');
        if (!['GET', 'POST', 'PATCH'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
        const response = await env.ASSETS.fetch(new Request(new URL('/data.json', url)));
        if (!response.ok) throw new HttpError(503, 'The developer snapshot is unavailable.');
        const data = await response.json();
        const developer = data.developers.find(d => d.login.toLowerCase() === match[1].toLowerCase());
        if (!developer) throw new HttpError(404, 'This developer is not in the current sample.');
        if (!developer.id) throw new HttpError(503, 'This profile needs an identity refresh before it can be claimed.');
        const githubId = String(developer.id);
        if (!env.DB) {
          if (request.method === 'GET') throw new HttpError(503, 'Profile details are unavailable. Please try again later.');
          throw new HttpError(503, 'Profile claiming is not available yet.');
        }
        const read = () => env.DB.prepare('SELECT * FROM profile_claims WHERE github_user_id = ?').bind(githubId).first();
        if (request.method === 'GET') return json({ ...publicClaim(await read()), claimsEnabled: configured });
        if (!configured) throw new HttpError(503, 'Profile claiming is not available yet.');
        if (request.headers.get('Origin') !== env.APP_ORIGIN || url.origin !== env.APP_ORIGIN) throw new HttpError(403, 'Please use Repo League directly to update your profile.');
        const user = await getUser(request, env);
        requireGitHubOwner(user, githubId);
        if (request.method === 'POST') {
          // Database uniqueness makes simultaneous attempts safe and prevents reassignment.
          await env.DB.prepare('INSERT INTO profile_claims (github_user_id, clerk_user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(githubId, user.id).run();
          const row = await read();
          if (!row || row.clerk_user_id !== user.id) throw new HttpError(409, 'This profile or your account already has a claim. Contact the site owner to resolve it.');
          return json({ ...publicClaim(row), ownedByYou: true });
        }
        const row = await read();
        if (!row || row.clerk_user_id !== user.id) throw new HttpError(403, 'Claim this profile with its owning account before editing.');
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Send profile edits as JSON.');
        const text = await request.text();
        if (text.length > 12000) throw new HttpError(413, 'Profile changes are too large.');
        let body;
        try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid profile changes.'); }
        const edits = validateEdits(body, developer);
        await env.DB.prepare("UPDATE profile_claims SET bio = ?, website = ?, featured_projects = ?, story = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE github_user_id = ? AND clerk_user_id = ?")
          .bind(edits.bio, edits.website, JSON.stringify(edits.featuredProjects), edits.story, githubId, user.id).run();
        return json({ ...publicClaim(await read()), ownedByYou: true });
      } catch (error) {
        // Never return provider errors, tokens, or database details to the browser.
        return json({ error: error instanceof HttpError ? error.message : 'Profile service is unavailable. Please try again.' }, error instanceof HttpError ? error.status : 503);
      }
    }
  };
}
export default createWorker();
