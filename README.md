# Repo League

A curated leaderboard of developers and their public, licensed, personally owned GitHub projects. Includes search, language and activity filters, comparisons, CSV export, and developer profiles.

The original Starboard source was recovered from its connected Sites repository into this initially empty checkout. This implementation adds a Cloudflare Worker, D1-backed profile claims, and Clerk integration. **Changes are local; no production deployment has been made.**

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

The collector retains numeric GitHub user IDs for claim verification and repository IDs for historical comparisons. Forks, organizations, and repositories without a detected SPDX license are excluded. Archived repositories remain available with filtering. API failures retain that developer's previous snapshot, record a non-sensitive error, and return a nonzero exit status. Each profile keeps its own fetch timestamp.

Latest successful refresh on 2026-09-11 at 16:20 UTC: 43 personal accounts checked, 41 with eligible projects, 3,013 projects, 3,188,420 stars, 268,386 forks, zero refresh errors. Two accounts have no eligible personal projects and do not appear in the leaderboard.

## Public pages and search indexing

`npm run build` generates the homepage and dedicated static HTML pages in `build/`. Content, statistics, and ordinary internal links are available before JavaScript runs:

- `/developers/` and `/developers/sharkdp/`: developer directory and portfolios, including all eligible project links, language breakdowns, and the existing claim/edit integration.
- `/projects/`, `/projects/page/2/`, and `/projects/sharkdp/bat/`: a directory with 48 projects per page and individual repository pages with source links, license, dates, topics, ownership, and related projects.
- `/languages/` and `/languages/rust/`: collections with at least 10 repositories from at least 3 developers. Language-specific rankings count only matching repositories; primary language comes from GitHub. Smaller collections remain accessible through homepage filters.

Routes use lowercase segments and trailing slashes. Cloudflare normalizes slash/index.html variants and returns an actual 404 for unknown pages. The original hash profile dialogs remain compatible with old links, but browsing and copied profile links point to dedicated pages. User-edited profile details are loaded from D1 after the GitHub-based HTML renders; those edits are not included in static metadata.

Set the **build-time** `SITE_URL` to the real production HTTPS origin to generate canonical URLs, Open Graph metadata, structured data, and `sitemap.xml`:

```sh
SITE_URL=https://your-domain.example npm run build
```

Without `SITE_URL`, builds are previews: HTML carries `noindex,follow` and no sitemap is generated. `npm run deploy` requires `SITE_URL`. Use the same origin as Clerk/Worker `APP_ORIGIN`; do not publish a placeholder domain.

Arbitrary date/filter combinations do not produce indexable routes. Current activity filters use latest push timestamps and **all-time** star counts. Competition pages stay noindex while collecting history and become indexable only when comparable standings exist. Completed calendar-week/month reports are available under `/reports/`; reports without comparable boundary observations stay noindex.

## Competition, following, and sharing

- `/trending/week/` and `/trending/month/` show **the climb**: rolling 7-day and 30-day net star gains. Each has All builders and Rising builders leagues. Rising builders had fewer than 10,000 eligible stars at the starting observation. Both use absolute net gains; ties share rank. The gap shown is the extra stars needed to pass the next higher score, assuming that score stays still. Rankings are ongoing, not final awards.
- The comparison uses complete observations on exact UTC dates 7 or 30 days apart, immutable repository IDs, and the same personal owner at both endpoints. Added, removed, transferred, or newly eligible repositories do not inflate the score. Negative changes count. Developers without matched repositories are excluded and coverage is disclosed. Incompatible/invalid history and stale comparisons cannot produce active standings. The initial dataset has one observation, so the actual site correctly shows **Collecting history**.
- Developer profiles show their scoped all-time rank with **Follow** and **Share update** actions. `/following/` keeps saved builders together across visits in the same browser, using GitHub IDs. It is local browser storage, not a Clerk-synced social graph; no email/push alerts are sent and following has no effect on scores.
- `/share/` provides developer spotlight drafts and, when positive comparable growth exists, weekly/monthly leaderboard stories. Share previews include editable text and a downloadable 1200×630 PNG card with date, rank, and sample/league scope. GitHub logins are not assumed to be X handles. [X Web Intents](https://docs.x.com/x-for-websites/web-intents/overview) open a composer for the user to review; no automatic posting or X credentials are used. Attach the downloaded PNG manually. These are downloadable cards, not automatic Open Graph images.
- With no production `SITE_URL`, users can preview/copy text and download cards, but the X composer link is hidden so local preview URLs are never shared publicly. `/following/` and `/share/` always remain noindex.

The ranking and post content refresh at build time after a data refresh. Running the data workflow alone does not update a deployed site; Cloudflare deployment still needs to be configured.

## Daily history

A successful full `npm run data:refresh` also writes `data/history/YYYY-MM-DD.json`. The first complete observation of each UTC day is preserved; subsequent runs update the current snapshot without replacing that day's baseline. Partial failures, stale profiles, or missing immutable IDs cannot become a historical baseline. History is kept outside public build assets. The initial baseline is September 11, 2026.

`.github/workflows/refresh-data.yml` is ready for a daily run at 06:17 UTC and manual **Run workflow**. It uses the runner's installed `gh` and repository `GITHUB_TOKEN`, tests/builds the result, then commits current data, history, and the announcement ledger. When the repository variable `SITE_URL` is configured, it also prepares social drafts (never publishes them). **Private repository:** [jackwalkerlabs/github-leaderboard](https://github.com/jackwalkerlabs/github-leaderboard), with `main` tracking `origin/main`. The daily workflow is active, but all five scheduled runs from September 12–16, 2026 were blocked before execution by GitHub account billing/spending limits. Resolve the account billing issue, then run the workflow manually and verify a successful data commit. The schedule alone does not establish fresh data. Allow the bot to commit data under your branch rules. GitHub schedules can be delayed. This workflow does not deploy the Cloudflare Worker; commits made with `GITHUB_TOKEN` do not trigger ordinary push-based Actions workflows.

The competition builder compares matched repository IDs across real observations on UTC dates 7 or 30 days apart and shows actual dates and coverage. Net star-count changes can be negative and do not represent unique users. Missing baselines are never treated as zero. Completed-period reports preserve their historical endpoint cohort. Rank-movement notifications are not implemented.

## Enable Clerk locally

This machine now uses the **Starboard** development application in Clerk's Personal Workspace, with GitHub as the sole sign-in provider. [Open its dashboard](https://dashboard.clerk.com/apps/app_3JCC0nrb6BcgcRBQRGHHwqUb2IP/instances/ins_3JCC0lK8zl15BaArsgOAbmnb1yk). Development keys are stored only in the ignored, mode-600 `.dev.vars`; they are not included in this repository. Local APP_ORIGIN is `http://localhost:8792`.

Verified September 11, 2026: GitHub OAuth signed in `jackwalkerlabs`, the local header showed an authenticated account, and the Worker verified the live Clerk session/GitHub identity and saved a D1 listing request. The listing remains pending import. Both sign-in and first-time sign-up now receive the same explicit return URL; regression tests cover onboarding and profile routes. No production deployment was made.

For a fresh checkout or another machine:

1. Create a Clerk application and enable GitHub as a social connection. Enable connecting GitHub from the account settings UI, including for users who signed in with another method.
2. Copy `.dev.vars.example` to `.dev.vars`. Set `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `APP_ORIGIN=http://localhost:8792`. The secret key is only read by the Worker.
3. Restart the development server. Open a developer profile and sign in. The matching GitHub account must be connected before claiming.

Clerk's UI and browser SDK are loaded from the Clerk Frontend API domain only when auth is configured, following the [JavaScript quickstart](https://clerk.com/docs/js-frontend/getting-started/quickstart). The Worker uses [authenticateRequest](https://clerk.com/docs/reference/backend/authenticate-request) with the configured frontend origin and only session tokens. Claims compare a verified external account's [providerUserId](https://clerk.com/docs/reference/backend/types/backend-external-account) against the snapshot's numeric GitHub user ID.

Claiming permits editing a 300-character bio, a 2,000-character builder story, an HTTPS website, and up to six featured eligible projects. These fields are stored separately from GitHub data. Stars, forks, eligibility, and ranking cannot be edited. The badge means GitHub account control was verified when claimed; it does not establish sole authorship or maintenance of every project.

The database enforces one claim per GitHub account and one claim per Clerk user. Repeated claims by the same owner are safe. Every write checks the live Clerk user and their connected GitHub identity; unlinking GitHub removes edit access. Reassignment/account recovery currently requires operator intervention. Instant self-service publication, organization project attribution, account-deletion cleanup, and self-service release of a claim are not implemented.

## Cloudflare deployment setup

The app uses a [Worker with static assets](https://developers.cloudflare.com/workers/static-assets/) and D1. When ready to deploy:

1. Run `npx wrangler d1 create starboard` in your Cloudflare account. Replace the all-zero local placeholder `database_id` in `wrangler.jsonc` with the returned ID.
2. Apply `npx wrangler d1 migrations apply starboard --remote`.
3. Set `APP_ORIGIN` and `CLERK_PUBLISHABLE_KEY` in the Wrangler `vars` configuration to the final site origin (without trailing slash) and production publishable key. Set the secret with `npx wrangler secret put CLERK_SECRET_KEY`.
4. Configure the production domain and GitHub OAuth connection in Clerk. Use that same origin for the Worker/custom domain.
5. Run `SITE_URL=https://your-domain.example npm run deploy` using the actual configured origin. Verify sign-in, connecting GitHub, claim ownership, saving edits, sign-out, and denial from a different account. Check the production canonical URLs and submit `/sitemap.xml` to your search tooling.

The `.openai/hosting.json` is the recovered historical Sites association. It describes the old static deployment, not this Worker API. Use Wrangler for the Cloudflare implementation; publishing this backend on Sites would need separate hosting configuration. No Sites version was saved or published in this session.

## Validation

`npm test` covers claim authorization and persistence against SQLite, invalid or foreign edits, unlinking GitHub, simulated Clerk UI flows, HTML escaping, the gh collector, snapshot integrity, immutable daily history, crawlable generated pages, metadata, internal links, pagination, preview indexing, and the no-fetch homepage fallback. It also covers matched-repository growth, transfers and missing history, tied ranks, baseline league membership, browser following persistence/storage failures, post drafts/intent URLs, PNG export wiring, and the transition from collecting to indexable standings. `npm run build` packages the frontend and generates public pages. `npx wrangler deploy --dry-run` checks Worker packaging without deploying.

Development GitHub OAuth is configured and browser-verified. Production Clerk OAuth and remote D1 still need configuration and end-to-end validation. The initial Chrome attachment refusal was resolved by preparing the existing approved profile. Design validation uses a task tab in the already-open Chrome window; no new browser was launched.

## Shared design with UseCLIs

Repo League vendors UseCLIs' font, color, typography, spacing, and radius tokens under `dist/design-system/`, including self-hosted Inconsolata and license notices. The layout uses compact ranking rows, neutral cards, dark primary buttons, and green metric accents. Secondary interest, minimum-star, and activity filters live under **More filters**; the summary indicates when any are active. Developer avatars, featured projects, and claiming retain Repo League's focus on people. The token snapshot is portable and does not require the UseCLIs checkout at build time.


## Indie Page playbook: portfolios → milestones → discovery

Research, scope and acceptance evidence live in [docs/indiepage-playbook.md](docs/indiepage-playbook.md). The adaptation keeps UseCLIs styling and uses GitHub project progress in place of revenue payments. Revenue claims from the video are not forecasts for Repo League.

- `/join/` helps existing builders find their portfolio. Unlisted builders can sign in, connect a verified GitHub account, and request a listing. The Worker resolves the immutable GitHub ID against GitHub's public user API, accepts personal accounts only, and persists one request per GitHub/Clerk identity. Requests are not claims and do not instantly publish a page. Without Clerk configuration, the UI explains that requests are not yet open.
- Owners can tell their builder story, link their website, and feature up to six eligible projects. Statistics remain read-only. Both database migrations are required.
- `/milestones/` celebrates first **observed** project crossings at 10, 50, 100, 500, 1k and larger thresholds. Initial snapshot totals are not new achievements. Repository IDs, owner continuity, and a historical high-water mark prevent imports, transfers, missing observations, and lost/re-gained stars from creating fake milestones. The same current repo/owner must remain in the directory for a milestone card to appear. Portfolios highlight three non-archived projects closest to their next threshold; project pages show progress too.
- `/reports/` links completed calendar weeks (Monday–Sunday UTC) and months. Routes use `/reports/week/YYYY-MM-DD/` and `/reports/month/YYYY-MM-DD/`. Counts compare observations on the starting day and the next period's starting day, with the exact timestamps disclosed; they are not exact midnight event counts. Both observations are required. All comparable endpoint developers remain in the report even if the current directory changes. Existing rolling 7/30-day climbs remain separate.
- `/share/` includes milestone and roundup drafts when supported by history. Daily developer spotlights rotate independently of portfolio size. Cards carry dates, scope and a link back to the project or builder; production PNGs include the public page address. `/announcements/` shows only operator-recorded published posts, never prepared drafts.

### Import requested builders

Apply migrations and configure Clerk first. To review requests, use D1's `listing_requests` table. The import command reads that queue and writes **only the local snapshot**, using the existing `gh` login to fetch public repositories:

```sh
npm run listings:import -- --local
# Once production D1 is configured, read its queue instead:
npm run listings:import -- --remote
npm run data:refresh
npm test
npm run build
```

The importer re-resolves immutable GitHub IDs, skips already-listed identities, and excludes accounts without eligible projects. Existing imported logins persist through future collector refreshes. Imports never manufacture history or claim a profile. Review the resulting diff and publish through the normal Cloudflare process; queue entries remain as a durable admission record. A requested account may still need eligibility review, and imports/deployment are currently operator-run.

### Prepare and record social posts

```sh
SITE_URL=https://YOUR-ACTUAL-DOMAIN npm run posts:prepare
# Review data/announcements.json. Publish the selected draft yourself.
# Only after it is live, record the real post URL:
npm run posts:published -- ANNOUNCEMENT_ID https://x.com/YOUR_ACCOUNT/status/POST_ID
npm run build
```

The ledger reserves at most three drafts per UTC day and at most one per developer, excludes developers featured or reserved in the preceding seven days, and deduplicates stable milestone/report IDs. Rerunning preparation does not duplicate the day's drafts. Stale snapshots do not produce new spotlights. Prepared items reserve their slot until the cooldown expires; the ledger distinguishes `prepared` from `published`. The command records a URL supplied by the operator; it does not independently verify that X posted it. Changes use a local exclusive lock and atomic file replacement. No X API token, outbound posting call, or automated pinning is present.

Commit the ledger with the snapshot/history so rebuilds and scheduled runs share announcement history. GitHub Actions prepares drafts only when `vars.SITE_URL` is set. The private GitHub remote is configured and the refresh workflow is active. Social draft preparation still requires `vars.SITE_URL`; Cloudflare deployment is not configured. No production posts or outreach were sent during implementation.

## Brand and existing integrations

The public product name is **Repo League** (formerly Starboard), with `repoleague` used for package and download names. The existing Clerk application display name, Cloudflare Worker/D1 names, Sites project association, and GitHub repository keep their original identifiers. Browser storage keys and internal events also remain stable so the rebrand preserves following preferences and claim flows. A production domain has not been selected or configured.
