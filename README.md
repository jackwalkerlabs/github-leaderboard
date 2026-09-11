# Starboard

A curated leaderboard of developers and their public, licensed, personally owned GitHub projects. Includes search, language and activity filters, comparisons, CSV export, and developer profiles.

The existing Starboard source was recovered from its connected Sites repository into this initially empty checkout. This implementation adds a Cloudflare Worker, D1-backed profile claims, and Clerk integration. **Changes are local; no production deployment has been made.**

## Run locally

Requires Node 22.13+ (tests use built-in SQLite), npm, and Python 3.9+.

```sh
npm ci
npm run db:migrate
npm run dev
```

Open http://localhost:8792. Browsing works without Clerk keys; profile claiming displays a coming-soon state. The D1 database is local. `dist/` contains the original static source files; `src/claims.js` adds account features; `npm run build` copies and bundles assets into `build/`. Rebuild after frontend edits, or restart `npm run dev`.

## Refresh from GitHub using gh

```sh
gh auth status
npm run data:refresh
npm run build
```

`collect_data.py` calls `gh api` through the existing GitHub CLI login, paginates repository results, and refreshes the curated `USERS` list plus existing profiles. Credentials stay in gh; no GitHub token is stored in source or shipped to the browser. The authenticated account needs access only to public information for this operation; private repositories are explicitly excluded even when the login can access them.

The collector retains numeric GitHub user IDs for claim verification. Forks, organizations, and repositories without a detected SPDX license are excluded. Archived repositories remain available with filtering. API failures retain that developer's previous snapshot, record a non-sensitive error, and return a nonzero exit status. Each profile keeps its own fetch timestamp; no automatic refresh schedule or historical growth tracking is configured.

Latest successful refresh on 2026-09-11: 43 personal accounts checked, 41 with eligible projects, 3,013 projects, 3,188,388 stars, 268,385 forks, zero refresh errors. Two accounts have no eligible personal projects and do not appear in the leaderboard.

## Enable Clerk locally

1. Create a Clerk application and enable GitHub as a social connection. Enable connecting GitHub from the account settings UI, including for users who signed in with another method.
2. Copy `.dev.vars.example` to `.dev.vars`. Set `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `APP_ORIGIN=http://localhost:8792`. The secret key is only read by the Worker.
3. Restart the development server. Open a developer profile and sign in. The matching GitHub account must be connected before claiming.

Clerk's UI and browser SDK are loaded from the Clerk Frontend API domain only when auth is configured, following the [JavaScript quickstart](https://clerk.com/docs/js-frontend/getting-started/quickstart). The Worker uses [authenticateRequest](https://clerk.com/docs/reference/backend/authenticate-request) with the configured frontend origin and only session tokens. Claims compare a verified external account's [providerUserId](https://clerk.com/docs/reference/backend/types/backend-external-account) against the snapshot's numeric GitHub user ID.

Claiming permits editing a 300-character bio, an HTTPS website, and up to six featured eligible projects. These fields are stored separately from GitHub data. Stars, forks, eligibility, and ranking cannot be edited. The badge means GitHub account control was verified when claimed; it does not establish sole authorship or maintenance of every project.

The database enforces one claim per GitHub account and one claim per Clerk user. Repeated claims by the same owner are safe. Every write checks the live Clerk user and their connected GitHub identity; unlinking GitHub removes edit access. Reassignment/account recovery currently requires operator intervention. New profiles outside the curated sample, organization project attribution, account-deletion cleanup, and self-service release of a claim are not implemented.

## Cloudflare deployment setup

The app uses a [Worker with static assets](https://developers.cloudflare.com/workers/static-assets/) and D1. When ready to deploy:

1. Run `npx wrangler d1 create starboard` in your Cloudflare account. Replace the all-zero local placeholder `database_id` in `wrangler.jsonc` with the returned ID.
2. Apply `npx wrangler d1 migrations apply starboard --remote`.
3. Set `APP_ORIGIN` and `CLERK_PUBLISHABLE_KEY` in the Wrangler `vars` configuration to the final site origin (without trailing slash) and production publishable key. Set the secret with `npx wrangler secret put CLERK_SECRET_KEY`.
4. Configure the production domain and GitHub OAuth connection in Clerk. Use that same origin for the Worker/custom domain.
5. Run `npm run deploy`. Verify sign-in, connecting GitHub, claim ownership, saving edits, sign-out, and denial from a different account.

The `.openai/hosting.json` is the recovered historical Sites association. It describes the old static deployment, not this Worker API. Use Wrangler for the Cloudflare implementation; publishing this backend on Sites would need separate hosting configuration. No Sites version was saved or published in this session.

## Validation

`npm test` covers claim authorization and persistence against SQLite, invalid or foreign edits, unlinking GitHub, UI flows with a simulated Clerk session, HTML escaping, the gh collector, and snapshot integrity. `npm run build` packages the frontend. `npx wrangler deploy --dry-run` checks Worker packaging without deploying.

Live Clerk OAuth and a remote D1 deployment still need account configuration and end-to-end validation. The initial Chrome attachment refusal was resolved by preparing the existing approved profile. Design validation uses a task tab in the already-open Chrome window; no new browser was launched.

## Shared design with UseCLIs

Starboard vendors UseCLIs' font, color, typography, spacing, and radius tokens under `dist/design-system/`, including self-hosted Inconsolata and license notices. The layout uses compact ranking rows, neutral cards, dark primary buttons, and green metric accents. Secondary interest, minimum-star, and activity filters live under **More filters**; the summary indicates when any are active. Developer avatars, featured projects, and claiming retain Starboard's focus on people. The token snapshot is portable and does not require the UseCLIs checkout at build time.
