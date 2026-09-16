import { HttpError, requireGitHubOwner } from './claims.js';

export async function listingRequest(request, env, getUser, githubFetch = fetch) {
  if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
  if (!(env.DB && env.APP_ORIGIN && env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY)) throw new HttpError(503, 'Listing requests open when GitHub sign-in is available.');
  const url = new URL(request.url);
  if (url.origin !== env.APP_ORIGIN || request.headers.get('Origin') !== env.APP_ORIGIN) throw new HttpError(403, 'Please use Repo League directly.');
  const user = await getUser(request, env);
  const account = user.externalAccounts?.find(a => ['github', 'oauth_github'].includes(a.provider) && a.verification?.status === 'verified');
  if (!account || !/^\d+$/.test(String(account.providerUserId))) throw new HttpError(403, 'Connect and verify your personal GitHub account in account settings first.');
  const id = String(account.providerUserId);
  requireGitHubOwner(user, id);
  const existing = await env.DB.prepare('SELECT login, requested_at FROM listing_requests WHERE github_user_id = ? AND clerk_user_id = ?').bind(id, user.id).first();
  if (existing) return { status: 'requested', login: existing.login, requestedAt: existing.requested_at };
  if (request.method === 'GET') return { status: 'not-requested' };
  const response = await githubFetch(`https://api.github.com/user/${id}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RepoLeague', 'X-GitHub-Api-Version': '2026-03-10' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new HttpError(503, 'GitHub could not verify your public account. Please try again later.');
  const profile = await response.json();
  if (String(profile.id) !== id || profile.type !== 'User' || !/^[a-z\d][a-z\d-]{0,38}$/i.test(profile.login)) throw new HttpError(400, 'Repo League currently lists personal GitHub accounts.');
  await env.DB.prepare('INSERT INTO listing_requests (github_user_id, clerk_user_id, login) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(id, user.id, profile.login).run();
  const saved = await env.DB.prepare('SELECT login, requested_at FROM listing_requests WHERE github_user_id = ? AND clerk_user_id = ?').bind(id, user.id).first();
  if (!saved) throw new HttpError(409, 'This account already has a listing request.');
  return { status: 'requested', login: saved.login, requestedAt: saved.requested_at };
}
