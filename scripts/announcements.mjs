import { readFile, readdir, writeFile, open, rename, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { engagementData } from './competition.mjs';
import { milestoneEvents, reports, prepareAnnouncements, rotatingProfiles } from './milestones.mjs';
import { profileCard } from './engagement-pages.mjs';
import { milestoneCard, reportCard } from './playbook-pages.mjs';
import { siteOrigin } from './site.mjs';

export function candidates(snapshot, history, origin, asOf) {
  const data = engagementData(snapshot, history, origin, asOf);
  const fresh = value => Date.parse(asOf) - Date.parse(value) <= 7 * 86400000;
  const milestones = milestoneEvents(history, snapshot).filter(e => fresh(e.to)).map(e => ({ ...milestoneCard(e), id: e.id }));
  const roundups = reports(history, snapshot, asOf).filter(r => fresh(r.endDate)).map(reportCard).filter(Boolean).map(c => ({ ...c, id: c.key }));
  const spotlights = fresh(snapshot.fetched_at) ? rotatingProfiles(data.profiles, asOf, data.profiles.length).map(p => ({ ...profileCard(p, data), developerId: p.id, id: `spotlight-${asOf.slice(0, 10)}-${p.id}`, source: `https://github.com/${p.login}` })) : [];
  return [...milestones, ...roundups, ...spotlights].map(c => ({ ...c, url: origin + c.path, text: `${c.text}\n${origin}${c.path}${c.source ? `\nSource: ${c.source}` : ''}` }));
}
export function recordPublished(ledger, id, url, at) {
  const parsed = new URL(url);
  if (!['x.com', 'twitter.com'].includes(parsed.hostname) || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/[A-Za-z0-9_]+\/status\/\d+$/.test(parsed.pathname)) throw new Error('Use the actual HTTPS X post URL after publishing.');
  const item = ledger.find(row => row.id === id);
  if (!item) throw new Error('Unknown prepared announcement');
  if (item.status === 'published' && item.postUrl !== parsed.href) throw new Error('Announcement already has a published URL');
  if (ledger.some(row => row.id !== id && row.postUrl === parsed.href)) throw new Error('That post URL is already recorded');
  return ledger.map(row => row.id === id ? { ...row, status: 'published', postUrl: parsed.href, publishedAt: row.publishedAt || at } : row);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] || 'prepare';
  if (!['prepare', 'published'].includes(command)) throw new Error('Use prepare, or published ANNOUNCEMENT_ID POST_URL');
  const filename = 'data/announcements.json', lock = await open(filename + '.lock', 'wx');
  try {
    let ledger = JSON.parse(await readFile(filename, 'utf8').catch(e => { if (e.code === 'ENOENT') return '[]'; throw e; }));
    const asOf = new Date().toISOString();
    if (command === 'published') ledger = recordPublished(ledger, process.argv[3], process.argv[4], asOf);
    else {
      const origin = siteOrigin(process.env.SITE_URL);
      if (!origin) throw new Error('Set SITE_URL to your public HTTPS origin before preparing posts.');
      const snapshot = JSON.parse(await readFile('dist/data.json', 'utf8'));
      const history = await Promise.all((await readdir('data/history')).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => readFile('data/history/' + f, 'utf8').then(JSON.parse)));
      const prepared = prepareAnnouncements(candidates(snapshot, history, origin, asOf), ledger, asOf);
      ledger.push(...prepared);
      console.log(`Prepared ${prepared.length} drafts. Nothing was posted. Review data/announcements.json.`);
    }
    await writeFile(filename + '.tmp', JSON.stringify(ledger, null, 2) + '\n');
    await rename(filename + '.tmp', filename);
  } finally { await lock.close(); await unlink(filename + '.lock'); }
}
