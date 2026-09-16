# Indie Page's playbook, adapted to Repo League

Sources inspected September 11, 2026:

- [Marc Lou — My SaaS made $2,370 in 2 weeks WITHOUT marketing](https://www.youtube.com/watch?v=DTJatExdQMI). Read the full public English captions; the source title/revenue is the creator's claim, not independently verified.
- [Indie Page](https://indiepa.ge/), [Marc's public portfolio](https://indiepa.ge/marclou), and [its leaderboard](https://indiepa.ge/leaderboard).

The video explains a product-led distribution loop: a small public tool promotes the core portfolio product (00:47–02:09); user achievements give projects exposure and a reason for their makers to reshare (02:12–03:20); recent-feature history prevents a handful of big accounts monopolizing attention (05:55–06:52); completed weekly/monthly roundups provide recurring stories (06:54–07:54). The launch depended partly on an existing large audience, which the creator explicitly acknowledges (07:57–09:15). Treat this as a design hypothesis for Repo League, not a promise of identical growth.

## Product direction

Repo League gives open-source builders a public home for their work and turns real project progress into discovery. The path is: preview your GitHub portfolio → claim and curate your page → follow progress → share an earned milestone → bring visitors to the project and developer → discover or create another page.

Keep the UseCLIs visual foundations. Adapt Indie Page's behavior and incentives; do not copy its branding, pricing, revenue claims, or UI wholesale. GitHub-sourced statistics and GitHub-account verification must remain separate concepts. Stars indicate attention, not users, code quality, or skill.

## Implementation and acceptance checklist

- [x] A clear portfolio-focused entry point and username flow that helps builders see and claim their own work, including a concrete path for developers outside the curated seed list.
- [x] Personal portfolio curation that lets owners explain what they build and direct visitors to their projects and relevant links, with validated inputs and existing ownership checks preserved.
- [x] Milestone progress on portfolios/projects and an achievement feed. A current threshold already exceeded is a snapshot fact; a newly crossed threshold requires comparable historical evidence. Added/transferred repositories and lost/re-gained stars must not create fake first-time achievements.
- [x] Completed calendar-week/month reports alongside rolling competition views, with real snapshot boundaries, scope, and source links. Missing history must produce an honest collecting state.
- [x] Repeatable, deduplicated post preparation that rotates developer exposure, credits actual builders/projects, includes source links, and keeps a durable announcement history. Do not call prepared content published.
- [x] Shareable cards and a route back to the builder's page; preview URLs must not leak into public post drafts. Public posting remains an explicit operator action, not something this development task sends to X.
- [x] Automated tests covering score/event integrity, fairness/deduplication, profile access/validation, and the public/onboarding/share flows; build and Worker checks; actual browser verification of the changed user flows.

## Operational boundaries

Work locally until hosting/auth/social accounts are configured. No deployment, account creation, purchases, outreach, or public posts are authorized by this implementation task. Existing GitHub data refresh is ready for Actions but has no configured remote. Record any remaining operational setup and verification gaps without claiming they are active.

## Verification record

Completed September 11, 2026:

- Portfolio entry: `/join/`, homepage/footer CTAs, configured Clerk admission requests in D1, and `npm run listings:import -- --local|--remote` using `gh` to fetch eligible public projects. Imports are operator-reviewed and local until deployment; the interface does not promise instant publication.
- Curation: persisted, escaped 2,000-character builder story alongside existing bio/website/featured projects. Server identity checks remain mandatory. Local migration `0002_portfolios.sql` applied.
- Milestones: `scripts/milestones.mjs` detects first observed crossings with immutable IDs, same-owner continuity and observed high-water marks. Portfolios and projects show current progress; `/milestones/` shows evidence-backed achievements only. The real dataset has one baseline, so its new-achievement feed is collecting history.
- Roundups: completed calendar-week/month routes under `/reports/`, exact observed timestamps and matched-project coverage. Endpoint cohorts survive live-directory changes. Missing-boundary pages stay noindex; ready reports and real achievements become indexable.
- Distribution: rotating public spotlight selection; daily draft preparation with stable IDs, a three-item cap and seven-day developer cooldown. `data/announcements.json` is a durable ledger. `/announcements/` includes only explicitly recorded published URLs. No announcement was published or marked published during implementation.
- Sharing: milestone/report cards reuse the editable draft and PNG exporter. Canonical public paths are used only when SITE_URL is configured; downloaded production cards print the return address. A real 1200×630 PNG was downloaded through the CUA MCP tool and inspected (`artifacts/playbook/alecthomas-share-card.png`, ignored by Git).
- Validation: 40 JavaScript tests plus five Python tests, full 3,147-route build (3,148 HTML files including 404), 115,879 resolved internal links, local D1 migration/import smoke check, and successful Wrangler deployment dry-run. Tests cover ready reports/achievements, historical cohort retention, deduplication, fairness, unsafe content, ownership, sign-in return paths, request failure/retry and import identity changes.
- Browser: reused Chrome pid 460/window 85; checked existing username → portfolio, unknown username → truthful configuration state, milestone progress, rotating spotlights, editable sharing and actual PNG export. Narrow layout verified with the native window capture, then restored to 1728×1050. No new browser/profile was launched. Raw native captures containing unrelated browser tabs were removed; only the task's exported card is retained.

Remaining activation requirements: production Cloudflare D1/Clerk/domain configuration, a GitHub remote/Actions activation, deployment, and live OAuth end-to-end checks. Social publication and listing imports remain explicit operator actions. There are no email notifications, X API publisher, automatic pinning, or paid plans. These are operational/product follow-ups, not features claimed as live.
