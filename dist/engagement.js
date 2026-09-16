(() => {
  const payload = document.getElementById('engagement-data');
  if (!payload) return;
  const data = JSON.parse(payload.textContent);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => new Intl.NumberFormat('en-US').format(value);
  const storageKey = 'starboard-following-v1';
  let following = new Set(), storageAvailable = true;
  const readFollowing = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      following = new Set(Array.isArray(stored) ? stored.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 2000) : []);
    } catch { following = new Set(); storageAvailable = false; }
  };
  readFollowing();
  let message = document.getElementById('following-status');
  if (!message) {
    message = document.createElement('p'); message.id = 'following-status'; message.className = 'engagement-status'; message.setAttribute('role', 'status');
    document.querySelector('.competition-profile, .competition-bottom, .competition-teaser, main')?.appendChild(message);
  }
  function renderFollowing() {
    const container = document.getElementById('following-list');
    if (container) {
      const selected = data.profiles.filter(profile => following.has(profile.id));
      container.innerHTML = selected.length ? `<div class="following-heading"><h2>${selected.length} builder${selected.length === 1 ? '' : 's'} you follow</h2><a href="/trending/week/">See the weekly climb →</a></div><div class="following-grid">${selected.map(profile => `<article class="following-card"><span class="eyebrow">#${profile.rank} BY ALL-TIME STARS · CURATED SAMPLE</span><h2><a href="${esc(profile.path)}">${esc(profile.name)}</a></h2><span class="following-login">GitHub: ${esc(profile.login)}</span><p><strong>★ ${number(profile.stars)}</strong> · ${number(profile.projects)} projects</p><p class="following-progress">${profile.weekly ? `${profile.weekly.gain > 0 ? '+' : ''}${number(profile.weekly.gain)} net stars · weekly rank #${profile.weekly.rank} · as of ${esc(data.week.endDate)}` : 'Weekly progress is collecting history.'}</p><div class="profile-actions"><button class="profile-button" data-follow-id="${profile.id}">Following ✓</button><button class="profile-button" data-share-key="profile-${profile.id}">Share update ↗</button></div></article>`).join('')}</div>` : `<div class="competition-empty"><h2>${following.size ? 'Your followed builders aren’t in this snapshot.' : 'Who are you rooting for?'}</h2><p>Open a developer profile and choose Follow. Their latest ranks will be here when you return.</p><a class="profile-button claim-primary" href="/developers/">Discover developers →</a></div>`;
    }
    document.querySelectorAll('[data-follow-id]').forEach(button => {
      const id = Number(button.dataset.followId), person = data.profiles.find(profile => profile.id === id);
      if (!person) return;
      const active = following.has(id);
      button.hidden = false; button.textContent = active ? 'Following ✓' : 'Follow';
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${active ? 'Unfollow' : 'Follow'} ${person.login}`);
    });
    document.querySelectorAll('[data-share-key]').forEach(button => { button.hidden = false; });
  }
  renderFollowing();
  if (!storageAvailable) message.textContent = 'Following could not be read in this browser. You can still explore and share profiles.';
  window.addEventListener('storage', event => { if (event.key === storageKey || event.key === null) { readFollowing(); renderFollowing(); } });

  const dialog = document.createElement('dialog'); dialog.id = 'share-dialog'; dialog.setAttribute('aria-labelledby', 'share-title');
  dialog.innerHTML = '<div class="dialog-top"><span class="eyebrow">PUBLIC WORK DESERVES CREDIT</span><button id="close-share" aria-label="Close share preview">✕</button></div><h2 id="share-title">Share a leaderboard update</h2><div id="share-card-preview" class="share-card-preview"><span id="card-scope"></span><strong id="card-rank"></strong><h3 id="card-name"></h3><p id="card-stats"></p><small id="card-date"></small><b>✦ repo league.</b></div><label class="share-text-label" for="share-text">Your post draft</label><textarea id="share-text" rows="5"></textarea><div class="profile-actions"><button class="profile-button claim-primary" id="copy-share">Copy post</button><button class="profile-button" id="download-share">Download PNG card ↓</button><a class="profile-button" id="share-on-x" target="_blank" rel="noopener noreferrer">Open draft on X ↗</a></div><p id="share-preview-note" class="page-note"></p><p id="share-status" role="status"></p>';
  document.body.appendChild(dialog);
  const input = dialog.querySelector('#share-text');
  const shareStatus = dialog.querySelector('#share-status');
  const xLink = dialog.querySelector('#share-on-x');
  let currentCard;
  function updateIntent() {
    if (!data.origin) { xLink.hidden = true; return; }
    const intent = new URL('https://twitter.com/intent/tweet');
    intent.searchParams.set('text', input.value);
    intent.searchParams.set('url', data.origin + currentCard.path);
    xLink.href = intent.href; xLink.hidden = false;
  }
  function openShare(key) {
    currentCard = data.cards.find(card => card.key === key);
    if (!currentCard) return;
    dialog.querySelector('#card-scope').textContent = currentCard.scope;
    dialog.querySelector('#card-rank').textContent = currentCard.primary;
    dialog.querySelector('#card-name').textContent = currentCard.title;
    dialog.querySelector('#card-stats').textContent = currentCard.secondary;
    dialog.querySelector('#card-date').textContent = currentCard.date;
    input.value = currentCard.text; shareStatus.textContent = '';
    dialog.querySelector('#share-preview-note').textContent = data.origin ? 'Review your draft before posting. Attach the downloaded PNG in X to include the card.' : 'Preview: public sharing opens on the live site. You can copy the draft and download the card now.';
    updateIntent();
    document.querySelectorAll('dialog[open]').forEach(open => open.close());
    dialog.showModal();
  }
  dialog.querySelector('#close-share').onclick = () => dialog.close();
  input.oninput = updateIntent;
  dialog.querySelector('#copy-share').onclick = async () => {
    const text = input.value + (data.origin ? '\n' + data.origin + currentCard.path : '');
    try { await navigator.clipboard.writeText(text); shareStatus.textContent = 'Post copied. Add your own take before sharing.'; }
    catch { input.focus(); input.select(); shareStatus.textContent = 'Copy the selected draft, then add the page link.'; }
  };
  dialog.querySelector('#download-share').onclick = async event => {
    const button = event.currentTarget, card = currentCard;
    button.disabled = true;
    try {
      await document.fonts?.ready;
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#f6f7f8'; ctx.fillRect(0, 0, 1200, 630);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(28, 28, 1144, 574);
      ctx.fillStyle = '#166534'; ctx.fillRect(28, 28, 1144, 8);
      const text = (value, x, y, size, color, maxWidth = 1072) => {
        ctx.fillStyle = color; ctx.font = `${size}px Inconsolata, monospace`;
        while (size > 14 && ctx.measureText(value).width > maxWidth) ctx.font = `${--size}px Inconsolata, monospace`;
        ctx.fillText(value, x, y);
      };
      text(card.scope, 64, 91, 25, '#657078');
      text(card.primary, 60, 251, 140, '#166534');
      text(card.title, 64, 342, 62, '#0b0e10');
      text(card.secondary, 64, 410, 34, '#0b0e10');
      text(card.date, 64, 483, 25, '#657078');
      text('✦ repo league.', 64, 564, 33, '#0b0e10');
      if (data.origin) text(new URL(data.origin).host + card.path, 365, 564, 21, '#657078', 750);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Image unavailable');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `repoleague-${card.key}-${card.date.slice(0, 10)}.png`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      shareStatus.textContent = 'PNG card downloaded. Attach it to your post.';
    } catch { shareStatus.textContent = 'Image download is unavailable in this browser. You can still copy the post draft.'; }
    finally { button.disabled = false; }
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.followId) {
      const id = Number(button.dataset.followId);
      if (!data.profiles.some(profile => profile.id === id)) return;
      const next = new Set(following), adding = !next.has(id);
      adding ? next.add(id) : next.delete(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next])); following = next;
        renderFollowing();
        message.textContent = adding ? 'Following saved in this browser. Check Following for their latest standings.' : 'Removed from your following.';
        document.querySelector(`[data-follow-id="${id}"]`)?.focus({ preventScroll: true });
      } catch { message.textContent = 'This browser could not save your following. Check its storage settings and try again.'; }
    }
    if (button.dataset.shareKey) openShare(button.dataset.shareKey);
  });
})();
