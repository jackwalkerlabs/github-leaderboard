import { rotatingProfiles } from './milestones.mjs';
import { milestoneCard, reportCard, joinCTA } from './playbook-pages.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = value => new Intl.NumberFormat('en-US').format(value);
const delta = value => (value > 0 ? '+' : '') + num(value);
const day = value => value?.slice(0, 10) || 'Not yet observed';
const path = login => `/developers/${encodeURIComponent(login.toLowerCase())}/`;
export const followButton = id => `<button class="profile-button" data-follow-id="${id}" aria-pressed="false" hidden>Follow</button>`;
export const shareButton = key => `<button class="profile-button" data-share-key="${esc(key)}" hidden>Share update ↗</button>`;

export function profileCard(profile, data) {
  const scope = `All-time stars · Repo League curated sample (${data.sampleSize} developers)`;
  return { key: `profile-${profile.id}`, title: profile.login, primary: `#${profile.rank}`, secondary: `${num(profile.stars)} stars · ${num(profile.projects)} projects`, scope,
    date: day(profile.observedAt), path: profile.path,
    text: `GitHub builder ${profile.login} is #${profile.rank} by all-time stars in Repo League's curated sample.\n${num(profile.stars)} stars across ${num(profile.projects)} projects.\nSnapshot: ${day(profile.observedAt)}.` };
}
export function growthCard(entry, board, league = 'all') {
  const period = board.days === 7 ? 'weekly' : 'monthly';
  const scope = `${board.days}-day net stars · ${league === 'rising' ? 'Rising builders' : 'All builders'} · Curated sample`;
  return { key: `${period}-${league}-${entry.id}`, title: entry.login, primary: `#${entry.rank}`, secondary: `${delta(entry.gain)} net stars · ${entry.matched} matched projects`, scope,
    date: `${board.baselineDate} → ${board.endDate}`, path: `/trending/${board.days === 7 ? 'week' : 'month'}/${league === 'rising' ? '#rising' : ''}`,
    text: `GitHub builder ${entry.login} is #${entry.rank} in Repo League's ${period} ${league === 'rising' ? 'Rising builders' : 'All builders'} ranking.\n${delta(entry.gain)} net stars across ${entry.matched} matched projects.\n${board.baselineDate}–${board.endDate} · Curated sample.` };
}
export function shareCards(data) {
  return [
    ...(data.events || []).map(milestoneCard),
    ...(data.reports || []).map(reportCard).filter(Boolean),
    ...data.profiles.map(profile => ({ ...profileCard(profile, data), developerId: profile.id })),
    ...[data.week, data.month].flatMap(board => board.status === 'ready' ? [
      ...board.entries.map(entry => growthCard(entry, board)),
      ...board.rising.map(entry => growthCard(entry, board, 'rising'))
    ] : [])
  ];
}
export function socialPayload(data, profiles = data.profiles) {
  const ids = new Set(profiles.map(profile => profile.id));
  return { origin: data.origin, profiles, week: { status: data.week.status, endDate: data.week.endDate }, cards: shareCards(data).filter(card => (!card.developerId && card.key.startsWith('report-')) || ids.has(card.developerId || Number(card.key.split('-').at(-1)))) };
}
export function profileCompetition(profile, data) {
  const week = profile.weekly;
  const pending = data.week.status === 'ready' ? 'This profile needs comparable weekly history' : data.week.status === 'stale' ? 'The weekly climb needs a fresh observation' : 'The weekly climb is collecting history';
  return `<section class="competition-profile" aria-label="Rank and following"><div><span class="eyebrow">LEAGUE STANDING</span><p><strong>#${profile.rank}</strong> by all-time stars <span>in our ${data.sampleSize}-developer sample</span></p>${week ? `<a href="/trending/week/">#${week.rank} this week · ${delta(week.gain)} net stars →</a>` : `<a href="/trending/week/">${pending} →</a>`}</div><div class="competition-profile-actions">${followButton(profile.id)}${shareButton(`profile-${profile.id}`)}<small>Following is saved in this browser.</small></div></section>`;
}
export function competitionTeaser(data) {
  const ready = data.week.status === 'ready';
  const status = ready ? `${data.week.baselineDate}–${data.week.endDate}` : data.week.status === 'stale' ? 'Waiting for fresh data' : 'Collecting 7-day history';
  return `<section class="competition-teaser" aria-labelledby="competition-teaser-title"><div><h2 id="competition-teaser-title">The weekly climb</h2><p>${ready ? 'Ranked by new attention, not lifetime totals.' : 'Weekly standings appear when comparable snapshots are available.'}</p></div><span class="collection-badge">${status}</span><a class="text-button" href="/trending/week/">${ready ? 'See standings' : 'View progress'} →</a></section>`;
}

function leaderboard(entries, board) {
  if (!entries.length) return '<p class="competition-empty">No developers have comparable projects in this league yet.</p>';
  return `<ol class="climb-list">${entries.map(entry => `<li><span class="climb-rank">#${entry.rank}</span><div class="climb-person"><a href="${path(entry.login)}">${esc(entry.name)}</a><small>GitHub: ${esc(entry.login)} · ${entry.matched} matched projects${entry.added || entry.removed ? ` · ${entry.added} added / ${entry.removed} removed excluded` : ''}</small></div><div class="climb-gain"><strong class="${entry.gain < 0 ? 'gain-negative' : entry.gain === 0 ? 'gain-neutral' : 'gain-positive'}">${delta(entry.gain)}</strong><small>net stars</small>${entry.toNextRank !== null ? `<span>${num(entry.toNextRank)} to pass the next rank</span>` : '<span>Top score in this league</span>'}</div><div class="climb-actions">${followButton(entry.id)}${shareButton(`${board.days === 7 ? 'weekly' : 'monthly'}-${board.league}-${entry.id}`)}</div></li>`).join('')}</ol>`;
}
export function competitionPage(board) {
  const period = board.days === 7 ? 'week' : 'month';
  const ready = board.status === 'ready';
  const empty = `<section class="competition-empty"><span class="collection-badge">${board.status === 'stale' ? 'Waiting for a fresh snapshot' : 'Collecting history'}</span><h2>${board.status === 'stale' ? 'This climb needs a fresh observation.' : 'Every climb starts somewhere.'}</h2><p>${board.firstDate ? `Our first complete observation is from ${board.firstDate}. ` : ''}The first ranking needs comparable snapshots taken ${board.days} days apart. We’ll show the standings when that comparison is available.</p><div class="history-progress"><strong>${board.observations}</strong><span>daily snapshot${board.observations === 1 ? '' : 's'} collected${board.endDate ? ` · latest ${board.endDate}` : ''}</span></div><a class="profile-button claim-primary" href="/developers/">Find builders to follow →</a></section>`;
  const rules = `<section class="competition-rules" id="competition-rules"><h2>How the climb works</h2><p>Standings compare net star counts over a rolling ${board.days}-day window, using the UTC dates of complete observations. Each repository must have the same GitHub ID and personal account owner at both endpoints. Newly included, removed, or transferred projects do not contribute to that period’s score. Negative changes count, and equal scores share a rank.</p><p>Rising builders had fewer than 10,000 total eligible stars at the starting observation. They compete on the same net-star metric. Claiming, following, and sharing never add points. This is a curated sample; stars measure attention, not developer skill.</p><p>Standings change with new snapshots. “Stars to pass” assumes the next score stays still. These are ongoing rankings, not final awards.</p><a href="/#methodology">Full eligibility methodology →</a></section>`;
  return { path: `/trending/${period}/`, title: `${board.days === 7 ? 'Weekly' : 'Monthly'} open source developer climb — Repo League`, description: `Follow developers competing on ${board.days}-day net GitHub star gains. Explore All builders and Rising builders leagues in Repo League's curated sample.`, crumbs: [[`${board.days === 7 ? 'Weekly' : 'Monthly'} climb`]], index: ready,
    body: `<div class="page-intro competition-intro"><span class="eyebrow">BUILD SOMETHING PEOPLE STAR</span><h1>The ${board.days === 7 ? 'weekly' : 'monthly'} <span>climb.</span></h1><p>Fresh progress. Familiar names. Your next builder to follow.</p><nav class="competition-tabs" aria-label="Competition period"><a href="/trending/week/" ${period === 'week' ? 'aria-current="page"' : ''}>Weekly · 7 days</a><a href="/trending/month/" ${period === 'month' ? 'aria-current="page"' : ''}>Monthly · 30 days</a><a href="/developers/">All-time stars</a><a href="/reports/">Completed roundups</a><a href="/milestones/">Milestones</a></nav></div>${ready ? `<div class="competition-period"><strong>${board.baselineDate} → ${board.endDate}</strong><span>${board.entries.length} comparable developers · ${board.excludedDevelopers} without comparable coverage</span></div><section class="page-section"><div class="section-heading"><h2>All builders</h2><a href="#competition-rules">How scores work ↓</a></div>${leaderboard(board.entries, { ...board, league: 'all' })}</section><section class="page-section" id="rising"><div class="section-heading"><h2>Rising builders <span class="count">Under 10k starting stars</span></h2></div><p class="league-description">A place for smaller portfolios to make their mark.</p>${leaderboard(board.rising, { ...board, league: 'rising' })}</section>` : empty}<div class="competition-bottom"><a class="profile-button" href="/following/">Check your following →</a><a class="profile-button" href="/share/">Leaderboard stories to share ↗</a></div>${rules}` };
}
export function followingPage() {
  return { path: '/following/', title: 'Developers you follow — Repo League', description: 'Keep the open source developers you follow together. Check their latest ranks and weekly progress on Repo League.', crumbs: [['Following']], index: false,
    body: '<div class="page-intro"><span class="eyebrow">YOUR CORNER OF OPEN SOURCE</span><h1>Builders you <span>follow.</span></h1><p>Keep an eye on their place in the standings. Your following is saved in this browser; no email notifications are sent.</p></div><div id="following-list"><div class="competition-empty"><h2>Keep your favorites close.</h2><p>Enable JavaScript to see your saved following. Open any developer profile and choose Follow.</p><a class="profile-button claim-primary" href="/developers/">Discover developers →</a></div></div><p id="following-status" class="page-note" role="status"></p>' };
}
export function storiesPage(data) {
  const cards = shareCards(data);
  const spotlight = rotatingProfiles(data.profiles, data.observedAt).map(profile => profileCard(profile, data));
  const movement = [data.week, data.month].flatMap(board => board.status === 'ready' ? [board.entries, board.rising].flatMap((entries, i) => entries.length && entries[0].gain > 0 ? [growthCard(entries[0], board, i ? 'rising' : 'all')] : []) : []);
  const choices = [...(data.events || []).slice(0, 6).map(milestoneCard), ...(data.reports || []).map(reportCard).filter(Boolean).slice(0, 2), ...movement, ...spotlight];
  return { path: '/share/', title: 'Leaderboard stories to share — Repo League', description: 'Share developer spotlights and evidence-backed leaderboard updates. Preview post drafts and download Repo League rank cards.', crumbs: [['Leaderboard stories']], index: false,
    body: `<div class="page-intro"><span class="eyebrow">GIVE PUBLIC WORK SOME CREDIT</span><a class="text-button" href="/announcements/">Published announcement history →</a><h1>A story worth <span>sharing.</span></h1><p>Celebrate project milestones, share completed roundups, and meet today’s rotating builder spotlights. Preview a post, download its card, and make it your own.</p></div><div class="story-grid">${choices.map(card => `<article class="story-card"><span class="eyebrow">${card.key.startsWith('profile-') ? 'DEVELOPER SPOTLIGHT' : card.key.startsWith('milestone-') ? 'PROJECT MILESTONE' : 'LEADERBOARD UPDATE'}</span><h2>${esc(card.title)}</h2><p class="story-draft">${esc(card.text)}</p><div class="profile-actions">${shareButton(card.key)}<a class="text-button" href="${card.path}">View source →</a></div></article>`).join('')}</div><p class="page-note">Spotlights rotate with daily snapshots, independently of star totals. GitHub usernames are shown as names, not assumed X handles. Every card includes its date and ranking scope. Posts open as drafts for you to review.</p>${joinCTA}` };
}
