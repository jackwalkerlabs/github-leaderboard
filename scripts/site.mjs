import { milestoneEvents, reports } from './milestones.mjs';
import { milestonePage, milestoneProgress, portfolioMilestones, reportsPage, reportPage, joinPage, announcementHistory } from './playbook-pages.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { engagementData } from './competition.mjs';
import { socialPayload, profileCompetition, competitionTeaser, competitionPage, followingPage, storiesPage } from './engagement-pages.mjs';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const number = value => new Intl.NumberFormat('en-US').format(value);
const date = value => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Unknown';
export const developerPath = login => `/developers/${encodeURIComponent(login.toLowerCase())}/`;
export const projectPath = name => `/projects/${name.split('/').map(part => encodeURIComponent(part.toLowerCase())).join('/')}/`;
export const languageSlug = language => ({ 'C++': 'c-plus-plus', 'C#': 'c-sharp', 'F#': 'f-sharp' }[language] || language.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
const languageName = language => ({ VimL: 'Vim Script', 'Vim script': 'Vim Script', Perl6: 'Raku', 'Perl 6': 'Raku' }[language] || language);
const stars = repos => repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
const forks = repos => repos.reduce((sum, repo) => sum + repo.forks_count, 0);
const byStars = (a, b) => b.stargazers_count - a.stargazers_count || a.full_name.localeCompare(b.full_name);

export function siteOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SITE_URL must be an HTTPS origin without a path, credentials, query, or fragment.');
  }
  return url.origin;
}

export async function generateSite({ snapshot, template, outDir, origin = null, history = [], ledger = [], asOf = snapshot.fetched_at }) {
  const engagement = { ...engagementData(snapshot, history, origin, asOf), events: milestoneEvents(history, snapshot), reports: reports(history, snapshot, asOf) };
  const developers = snapshot.developers.filter(d => d.repos.length).sort((a, b) => b.total_stars - a.total_stars || a.login.localeCompare(b.login));
  const projects = developers.flatMap(owner => owner.repos.map(repo => ({ ...repo, owner }))).sort(byStars);
  const languageGroups = new Map();
  for (const project of projects) {
    if (!project.language) continue;
    const name = languageName(project.language);
    if (!languageGroups.has(name)) languageGroups.set(name, []);
    languageGroups.get(name).push(project);
  }
  // Publish only collections broad enough to be useful as independent entry pages.
  const languages = [...languageGroups].filter(([, repos]) => repos.length >= 10 && new Set(repos.map(r => r.owner.id)).size >= 3).sort(([a], [b]) => a.localeCompare(b));
  const languagePaths = new Map(languages.map(([name]) => [name, `/languages/${languageSlug(name)}/`]));
  if (new Set(languagePaths.values()).size !== languages.length) throw new Error('Language route collision');
  const shell = new JSDOM(template);
  const document = shell.window.document;
  const header = document.querySelector('.site-header').outerHTML;
  const finder = document.getElementById('claim-directory').outerHTML;
  const footer = document.querySelector('footer').outerHTML;
  const baseHead = document.head.innerHTML.replace(/<title>.*?<\/title>/s, '').replace(/<meta name="description"[^>]*>/, '');
  const directory = developers.map(({ login, name }) => ({ login, name }));
  const routes = [];
  const languageLink = name => {
    const normalized = languageName(name);
    return languagePaths.has(normalized) ? `<a class="language-tag" href="${languagePaths.get(normalized)}">${escape(normalized)}</a>` : `<span class="language-tag">${escape(normalized || 'Unspecified')}</span>`;
  };
  const metadata = (title, description, path, index = true) => `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="${origin && index ? 'index,follow' : 'noindex,follow'}">${origin ? `<link rel="canonical" href="${escape(origin + path)}"><meta property="og:url" content="${escape(origin + path)}">` : ''}<meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">`;
  const breadcrumb = parts => `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a>${parts.map(([label, path]) => `<span aria-hidden="true">/</span>${path ? `<a href="${path}">${escape(label)}</a>` : `<span aria-current="page">${escape(label)}</span>`}`).join('')}</nav>`;
  const provenance = fetchedAt => `<aside class="page-provenance"><strong>A snapshot of public work.</strong><p>Observed ${date(fetchedAt || snapshot.fetched_at)} (UTC). Stars and forks are all-time counts. This is a curated sample, not a global ranking. Personal account ownership does not establish original authorship or sole maintenance.</p><a href="/#methodology">Read the ranking methodology →</a></aside>`;
  const stats = values => `<dl class="page-stats">${values.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
  const card = repo => `<article class="project"><div class="project-owner"><a href="${developerPath(repo.owner.login)}"><img src="${escape(repo.owner.avatar_url)}" alt="" width="21" height="21" loading="lazy">${escape(repo.owner.login)}</a>${repo.archived ? '<span class="archived">Archived</span>' : ''}</div><div class="project-top"><a href="${projectPath(repo.full_name)}">${escape(repo.name)} →</a><span>★ ${number(repo.stargazers_count)}</span></div><p>${escape(repo.description || 'No description provided on GitHub.')}</p><div class="repo-meta">${languageLink(repo.language)}<span>${escape(repo.license.spdx_id)}</span><span>${number(repo.forks_count)} forks</span></div><div class="push-date">Last push ${date(repo.pushed_at)}</div></article>`;
  const table = (people, label = 'All-time stars') => `<div class="directory-table"><table><thead><tr><th scope="col">Rank</th><th scope="col">Developer</th><th scope="col">${escape(label)}</th><th scope="col">Projects</th></tr></thead><tbody>${people.map((d, i) => `<tr><td class="rank">${String(people.findIndex(other => stars(other.repos) === stars(d.repos)) + 1).padStart(2, '0')}</td><th scope="row"><a class="directory-person" href="${developerPath(d.login)}"><img class="avatar" src="${escape(d.avatar_url)}" alt="" width="40" height="40" loading="lazy"><span>${escape(d.name || d.login)}<small>@${escape(d.login)}</small></span></a></th><td class="number stars">${number(stars(d.repos))}</td><td class="number">${number(d.repos.length)}</td></tr>`).join('')}</tbody></table></div>`;
  const compactProjects = repos => `<ul class="compact-projects">${repos.map(repo => `<li><a href="${projectPath(repo.full_name)}">${escape(repo.full_name)}</a><span>★ ${number(repo.stargazers_count)}</span></li>`).join('')}</ul>`;
  const projectCollection = repos => `<div class="projects">${repos.slice(0, 24).map(card).join('')}</div>${repos.length > 24 ? `<details class="remaining-projects"><summary>Browse ${number(repos.length - 24)} more projects</summary>${compactProjects(repos.slice(24))}</details>` : ''}`;
  async function page({ path, title, description, body, crumbs = [], profile = null, schema = null, index = true, social = null }) {
    if (profile) {
      const ranked = engagement.profiles.find(person => person.id === profile.id);
      body = body.replace('<section id="profile-claim"', profileCompetition(ranked, engagement) + portfolioMilestones(profile, engagement.events) + '<section id="profile-claim"');
      social = socialPayload(engagement, [ranked]);
    }
    const filename = path === '/404.html' ? '404.html' : path.slice(1) + 'index.html';
    const destination = join(outDir, filename);
    await mkdir(join(destination, '..'), { recursive: true });
    const graph = origin ? [schema, { '@type': 'BreadcrumbList', itemListElement: [['Home', '/'], ...crumbs].map(([name, route], i) => ({ '@type': 'ListItem', position: i + 1, name, item: origin + (route || path) })) }].filter(Boolean) : [];
    const html = `<!doctype html><html lang="en"><head>${baseHead}${metadata(title, description, path, index)}${graph.length ? `<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>` : ''}</head><body><a class="skip-link" href="#main">Skip to content</a>${header}<p id="account-status" class="account-status" role="status"></p><main id="main" class="content-page">${breadcrumb(crumbs)}${body}</main>${finder}${footer}<script id="page-data" type="application/json">${json({ developers: directory, profile })}</script><script src="/page.js" defer></script><script type="module" src="/claims.js"></script>${social ? `<script id="engagement-data" type="application/json">${json(social)}</script><script src="/engagement.js" defer></script>` : ''}</body></html>`;
    await writeFile(destination, html);
    if (path !== '/404.html') routes.push({ path, lastmod: profile?.fetched_at || snapshot.fetched_at, index });
  }

  // The interactive homepage remains usable and linked when scripts or the data fetch fail.
  document.head.insertAdjacentHTML('beforeend', metadata('Starboard — Open source developer leaderboard', 'Discover open source developers and their projects, ranked by GitHub stars in a curated sample. Browse developer portfolios, projects, and programming languages.', '/').replace(/<title>.*?<\/title>/s, '').replace(/<meta name="description"[^>]*>/, ''));
  document.getElementById('developer-count').textContent = number(developers.length);
  document.getElementById('project-count').textContent = number(projects.length);
  document.getElementById('star-count').textContent = number(stars(projects));
  document.getElementById('snapshot-date').textContent = date(snapshot.fetched_at);
  document.getElementById('result-count').textContent = `${number(developers.length)} developers · most stars first`;
  document.getElementById('count').textContent = number(developers.length);
  document.getElementById('table-head').hidden = true;
  document.getElementById('rows').innerHTML = table(developers);
  document.getElementById('rows').dataset.prerendered = 'true';
  document.getElementById('data-time').textContent = `Dataset assembled ${new Date(snapshot.fetched_at).toUTCString()}. Profiles show their own observation dates.`;
  document.querySelector('.intro').insertAdjacentHTML('afterend', competitionTeaser(engagement));
  document.body.insertAdjacentHTML('beforeend', `<script id="engagement-data" type="application/json">${json(socialPayload(engagement))}</script><script src="/engagement.js" defer></script>`);
  await writeFile(join(outDir, 'index.html'), shell.serialize());
  routes.push({ path: '/', lastmod: snapshot.fetched_at, index: true });
  shell.window.close();

  for (const specification of [competitionPage(engagement.week), competitionPage(engagement.month), followingPage(), storiesPage(engagement), milestonePage(engagement.events), reportsPage(engagement.reports), ...engagement.reports.map(reportPage), joinPage(), announcementHistory(ledger)]) {
    await page({ ...specification, social: socialPayload(engagement) });
  }

  await page({ path: '/developers/', title: 'Open source developers ranked by GitHub stars — Starboard', description: `Browse ${developers.length} open source developers, their GitHub projects, star counts, and public portfolios in the Starboard curated sample.`, crumbs: [['Developers']], body: `<div class="page-intro"><span class="eyebrow">THE PEOPLE BEHIND THE PROJECTS</span><h1>Open source developers</h1><p>${number(developers.length)} builders, ranked by all-time stars across their eligible personal repositories.</p></div>${table(developers)}${provenance()}` });
  for (const d of developers) {
    const repos = d.repos.map(repo => ({ ...repo, owner: d })).sort(byStars);
    const counts = new Map();
    for (const repo of repos) if (repo.language) { const name = languageName(repo.language); counts.set(name, (counts.get(name) || 0) + 1); }
    const languageBreakdown = [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => `<li>${languageLink(name)}<span>${number(count)} projects</span></li>`).join('');
    await page({ path: developerPath(d.login), title: `${d.name || d.login} (@${d.login}) — Open source projects & GitHub stars | Starboard`, description: `Explore ${d.login}'s ${number(repos.length)} open source projects with ${number(d.total_stars)} GitHub stars and ${number(d.total_forks)} forks. ${repos.slice(0, 3).map(r => r.name).join(', ')} and more.`, crumbs: [['Developers', '/developers/'], [d.login]], profile: d,
      schema: { '@type': 'ProfilePage', dateModified: d.fetched_at || snapshot.fetched_at, mainEntity: { '@type': 'Person', name: d.name || d.login, alternateName: d.login, url: origin + developerPath(d.login), sameAs: [d.html_url], description: d.bio || undefined, image: d.avatar_url } },
      body: `<div class="page-intro"><span class="eyebrow">DEVELOPER PORTFOLIO</span><div class="profile-hero"><img class="profile-avatar" src="${escape(d.avatar_url)}" alt="" width="76" height="76"><div><h1>${escape(d.name || d.login)}</h1><span>@${escape(d.login)}${d.location ? ` · ${escape(d.location)}` : ''}</span></div></div><p class="profile-bio">${escape(d.bio || 'Explore this developer’s public open source projects.')}</p><div class="profile-actions"><a class="profile-button" href="${escape(d.html_url)}" target="_blank" rel="noopener noreferrer">GitHub profile ↗</a><a class="profile-button" href="/#compare=${encodeURIComponent(d.login)}">Compare developer</a><button id="copy-profile" class="profile-button" hidden>Copy profile link</button><span id="copy-status" role="status"></span></div></div>${stats([['All-time stars', number(d.total_stars)], ['Projects', number(repos.length)], ['Forks', number(d.total_forks)], ['GitHub followers', number(d.followers)]])}<section id="profile-claim" class="profile-claim" aria-label="Profile ownership and featured work"><h2>Make this profile yours</h2><p>Enable JavaScript to check profile claiming availability.</p></section><section class="page-section"><h2>Languages across projects</h2><ul class="language-list">${languageBreakdown || '<li>No primary language detected.</li>'}</ul></section><section class="page-section"><div class="section-heading"><h2>Open source projects <span class="count">${number(repos.length)}</span></h2><span>Most stars first</span></div>${projectCollection(repos)}</section><p class="profile-coverage">${number(repos.filter(r => !r.archived).length)} non-archived · ${number(repos.filter(r => r.archived).length)} archived · ${number(d.excluded_repos)} repositories excluded by eligibility rules.</p>${provenance(d.fetched_at)}` });
  }

  const pageSize = 48, totalPages = Math.ceil(projects.length / pageSize);
  const directoryPath = n => n === 1 ? '/projects/' : `/projects/page/${n}/`;
  for (let n = 1; n <= totalPages; n++) {
    const slice = projects.slice((n - 1) * pageSize, n * pageSize);
    await page({ path: directoryPath(n), title: `Open source projects ranked by GitHub stars${n > 1 ? ` — Page ${n}` : ''} | Starboard`, description: `Browse open source projects ${number((n - 1) * pageSize + 1)}–${number(Math.min(n * pageSize, projects.length))} of ${number(projects.length)}, ranked by all-time GitHub stars. Find their developers, languages, and licenses.`, crumbs: n === 1 ? [['Projects']] : [['Projects', '/projects/'], [`Page ${n}`]], body: `<div class="page-intro"><span class="eyebrow">PUBLIC WORK, PERSONAL OWNERSHIP</span><h1>Open source projects${n > 1 ? ` <span>· Page ${n}</span>` : ''}</h1><p>${number(projects.length)} public, non-fork, licensed repositories from the developers in our sample. Ranked by all-time stars.</p></div><div class="projects">${slice.map(card).join('')}</div><nav class="pagination" aria-label="Project pages">${n > 1 ? `<a class="profile-button" href="${directoryPath(n - 1)}">← Previous</a>` : ''}<span>Page ${n} of ${totalPages}</span>${n < totalPages ? `<a class="profile-button" href="${directoryPath(n + 1)}">Next →</a>` : ''}</nav>${provenance()}` });
  }
  for (const repo of projects) {
    const d = repo.owner;
    const related = d.repos.filter(r => r.full_name !== repo.full_name).sort(byStars).slice(0, 4).map(r => ({ ...r, owner: d }));
    let homepage;
    try { const url = new URL(repo.homepage); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) homepage = url.href; } catch {}
    await page({ path: projectPath(repo.full_name), title: `${repo.full_name} — GitHub stars, project & developer | Starboard`, description: `${repo.full_name}: ${number(repo.stargazers_count)} GitHub stars, ${number(repo.forks_count)} forks, ${repo.license.spdx_id} license. ${(repo.description || 'Explore this open source project and its account owner.').slice(0, 120)}`, crumbs: [['Projects', '/projects/'], [repo.full_name]],
      schema: { '@type': 'SoftwareSourceCode', name: repo.full_name, description: repo.description || undefined, codeRepository: repo.html_url, programmingLanguage: repo.language || undefined, license: `https://spdx.org/licenses/${encodeURIComponent(repo.license.spdx_id)}.html`, url: origin + projectPath(repo.full_name) },
      body: `<div class="page-intro"><span class="eyebrow">OPEN SOURCE PROJECT${repo.archived ? ' · ARCHIVED' : ''}</span><h1>${escape(repo.name)}</h1><p class="project-attribution">Owned on GitHub by <a href="${developerPath(d.login)}">@${escape(d.login)} →</a></p><p class="project-description">${escape(repo.description || 'No description provided on GitHub.')}</p><div class="profile-actions"><a class="profile-button claim-primary" href="${escape(repo.html_url)}" target="_blank" rel="noopener noreferrer">View repository on GitHub ↗</a>${homepage ? `<a class="profile-button" href="${escape(homepage)}" target="_blank" rel="noopener noreferrer nofollow">Project website ↗</a>` : ''}</div></div>${stats([['All-time stars', number(repo.stargazers_count)], ['Forks', number(repo.forks_count)], ['License', repo.license.spdx_id], ['Status', repo.archived ? 'Archived' : 'Not archived']])}${milestoneProgress(repo)}<section class="page-section"><h2>About this repository</h2><dl class="project-facts"><div><dt>Primary language</dt><dd>${languageLink(repo.language)}</dd></div><div><dt>Created on GitHub</dt><dd>${date(repo.created_at)}</dd></div><div><dt>Last push</dt><dd>${date(repo.pushed_at)}</dd></div><div><dt>Repository</dt><dd>${escape(repo.full_name)}</dd></div></dl>${repo.topics?.length ? `<ul class="topic-list" aria-label="GitHub topics">${repo.topics.map(topic => `<li>${escape(topic)}</li>`).join('')}</ul>` : ''}<p class="page-note">Last push describes repository activity. It does not measure star growth or confirm ongoing maintenance.</p></section>${related.length ? `<section class="page-section"><div class="section-heading"><h2>More projects from @${escape(d.login)}</h2><a href="${developerPath(d.login)}">View developer →</a></div><div class="projects">${related.map(card).join('')}</div></section>` : ''}${provenance(d.fetched_at)}` });
  }

  await page({ path: '/languages/', title: 'Open source projects by programming language — Starboard', description: 'Explore programming languages, their open source projects, and developers in the Starboard GitHub sample. Compare all-time stars within each language.', crumbs: [['Languages']], body: `<div class="page-intro"><span class="eyebrow">FIND YOUR CORNER OF OPEN SOURCE</span><h1>Browse by language</h1><p>Explore collections with at least 10 projects from at least 3 developers in our sample. GitHub’s primary repository language determines each collection.</p></div><div class="language-grid">${languages.map(([name, repos]) => `<a class="language-card" href="${languagePaths.get(name)}"><h2>${escape(name)} →</h2><strong>★ ${number(stars(repos))}</strong><span>${number(repos.length)} projects · ${new Set(repos.map(r => r.owner.id)).size} developers</span></a>`).join('')}</div>${provenance()}` });
  for (const [name, repos] of languages) {
    const people = developers.map(d => ({ ...d, repos: repos.filter(r => r.owner.id === d.id) })).filter(d => d.repos.length).sort((a, b) => stars(b.repos) - stars(a.repos));
    await page({ path: languagePaths.get(name), title: `${name} open source projects & developers — Starboard`, description: `Discover ${repos.length} ${name} open source projects from ${people.length} developers, with ${number(stars(repos))} combined GitHub stars. Explore repositories, licenses, and developer portfolios.`, crumbs: [['Languages', '/languages/'], [name]], body: `<div class="page-intro"><span class="eyebrow">OPEN SOURCE BY LANGUAGE</span><h1>${escape(name)} projects <span>&amp; their developers</span></h1><p>Repositories whose primary language on GitHub is ${escape(name)}. Rankings count only matching projects within our curated sample.</p></div>${stats([['All-time stars', number(stars(repos))], ['Projects', number(repos.length)], ['Developers', number(people.length)], ['Forks', number(forks(repos))]])}<section class="page-section"><h2>Developers building with ${escape(name)}</h2>${table(people, `${name} stars`)}</section><section class="page-section"><div class="section-heading"><h2>${escape(name)} projects</h2><span>Most stars first</span></div>${projectCollection(repos)}</section>${provenance()}` });
  }
  await page({ path: '/404.html', title: 'Page not found — Starboard', description: 'This Starboard page does not exist. Browse developers, projects, or programming languages.', index: false, crumbs: [['Page not found']], body: '<div class="page-intro"><span class="eyebrow">404</span><h1>That page isn’t here.</h1><p>Find a developer or project in our curated open source directory.</p><div class="profile-actions"><a class="profile-button claim-primary" href="/developers/">Browse developers →</a><a class="profile-button" href="/projects/">Browse projects →</a></div></div>' });
  if (new Set(routes.map(route => route.path)).size !== routes.length) throw new Error('Duplicate generated route');
  if (origin) {
    await writeFile(join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.filter(route => route.index).map(({ path, lastmod }) => `<url><loc>${escape(origin + path)}</loc><lastmod>${escape(lastmod)}</lastmod></url>`).join('')}</urlset>`);
  }
  await writeFile(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /data.json\n${origin ? `\nSitemap: ${origin}/sitemap.xml\n` : '\n# Preview build: HTML pages carry noindex. Set SITE_URL for production.\n'}`);
  return { pages: routes.length, developers: developers.length, projects: projects.length, languages: languages.length, routes };
}
