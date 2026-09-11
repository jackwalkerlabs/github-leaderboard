export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireGitHubOwner(user, githubId) {
  const matches = user.externalAccounts?.some(account =>
    ['github', 'oauth_github'].includes(account.provider) &&
    account.verification?.status === 'verified' &&
    String(account.providerUserId) === String(githubId)
  );
  if (!matches) throw new HttpError(403, 'Connect the GitHub account that owns this profile in your account settings, then try again.');
}
export function validateEdits(body, developer) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['bio', 'website', 'featuredProjects'].includes(key))) {
    throw new HttpError(400, 'Only bio, website, and featured projects can be edited.');
  }
  if (typeof body.bio !== 'string' || body.bio.length > 300 ||
      typeof body.website !== 'string' || body.website.length > 500 ||
      !Array.isArray(body.featuredProjects) || body.featuredProjects.length > 6) {
    throw new HttpError(400, 'Use a bio up to 300 characters, a website up to 500 characters, and at most six featured projects.');
  }
  const website = body.website.trim();
  if (website) {
    let url;
    try { url = new URL(website); } catch { throw new HttpError(400, 'Enter a valid HTTPS website address.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new HttpError(400, 'Enter a valid HTTPS website address.');
  }
  const eligible = new Set(developer.repos.map(repo => repo.full_name));
  if (body.featuredProjects.some(name => typeof name !== 'string' || !eligible.has(name)) ||
      new Set(body.featuredProjects).size !== body.featuredProjects.length) {
    throw new HttpError(400, 'Featured projects must be distinct projects from this profile.');
  }
  return { bio: body.bio.trim(), website, featuredProjects: body.featuredProjects };
}
export function publicClaim(row) {
  return row ? { claimed: true, bio: row.bio, website: row.website,
    featuredProjects: JSON.parse(row.featured_projects), claimedAt: row.claimed_at } : { claimed: false };
}
