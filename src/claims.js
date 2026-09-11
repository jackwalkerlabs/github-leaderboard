
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let clerk, enabled = false, ready = false, current, revision = 0;
let pendingLogin = sessionStorage.getItem('starboard-claim-profile');
const status = message => { document.getElementById('account-status').textContent = message; };

async function api(path, method = 'GET', body) {
  const headers = {};
  if (method !== 'GET') {
    const token = await clerk?.session?.getToken();
    if (!token) throw new Error('Sign in before claiming or editing your profile.');
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Profile claiming is not available on this preview yet.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The profile service is unavailable. Please try again.');
  return data;
}
async function loadClerk(publishableKey) {
  // Clerk's documented CDN setup keeps authentication off the browsing path.
  const domain = atob(publishableKey.split('_')[2]).replace(/\$$/, '');
  if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error('Invalid authentication configuration.');
  const loadScript = (path, attributes = {}) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => reject(new Error('Authentication took too long to load.')), 15000);
    script.src = `https://${domain}/npm/${path}`;
    script.async = true; script.crossOrigin = 'anonymous';
    Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Authentication could not be loaded.')); };
    document.head.appendChild(script);
  });
  await Promise.all([
    loadScript('@clerk/ui@1/dist/ui.browser.js'),
    loadScript('@clerk/clerk-js@6.31.1/dist/clerk.browser.js', { 'data-clerk-publishable-key': publishableKey })
  ]);
  await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  return window.Clerk;
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }
function openProfile(login) { document.dispatchEvent(new CustomEvent('starboard:open-profile', { detail: login })); }
function startSignIn(login) {
  pendingLogin = login;
  sessionStorage.setItem('starboard-claim-profile', login);
  closeDialogs();
  clerk.openSignIn({ forceRedirectUrl: `${location.origin}/#developer=${encodeURIComponent(login)}` });
}
function ownGitHub(developer) {
  return clerk?.user?.externalAccounts.some(account =>
    ['github', 'oauth_github'].includes(account.provider) && String(account.providerUserId) === String(developer.id));
}
function accountSettings() { closeDialogs(); clerk.openUserProfile(); status('Connect GitHub in your account settings, then reopen your developer profile.'); }
function editorHTML(developer, profile) {
  return `<form id="profile-editor"><label>Your bio <textarea name="bio" maxlength="300" rows="3" placeholder="What are you building?">${escape(profile.bio)}</textarea></label><label>Website <input name="website" type="url" maxlength="500" placeholder="https://your-site.com" value="${escape(profile.website)}"></label><fieldset><legend>Featured projects <span>Choose up to six</span></legend><div class="featured-picker">${developer.repos.map(repo => `<label><input type="checkbox" name="featured" value="${escape(repo.full_name)}" ${profile.featuredProjects.includes(repo.full_name) ? 'checked' : ''}>${escape(repo.name)}</label>`).join('')}</div></fieldset><p class="claim-note">Your selections appear above the project list. Stars, forks, and ranking always come from GitHub.</p><div class="claim-actions"><button class="profile-button claim-primary" type="submit">Save profile</button><button class="text-button" type="button" id="cancel-profile-edit">Cancel</button></div><p id="edit-status" role="status"></p></form>`;
}
async function renderClaim(developer) {
  current = developer;
  const turn = ++revision;
  const slot = document.getElementById('profile-claim');
  if (!slot) return;
  slot.innerHTML = '<p class="claim-note" role="status">Loading profile details…</p>';
  if (!ready) return;
  let profile;
  try { profile = await api(`/api/profiles/${encodeURIComponent(developer.login)}`); }
  catch (error) {
    if (turn !== revision) return;
    slot.innerHTML = `<h3>Make this profile yours</h3><p role="status">${escape(error.message)}</p><button class="profile-button" id="retry-claim">Try again</button>`;
    slot.querySelector('#retry-claim').onclick = () => renderClaim(developer);
    return;
  }
  if (turn !== revision) return;
  const ownedAccount = ownGitHub(developer);
  const featured = (profile.featuredProjects || []).map(name => developer.repos.find(repo => repo.full_name === name)).filter(Boolean);
  slot.innerHTML = `<div class="claim-heading"><span class="eyebrow">${profile.claimed ? 'CLAIMED PROFILE' : 'YOUR WORK, YOUR STORY'}</span>${profile.claimed ? '<span class="claim-badge" title="GitHub account ownership was verified when this profile was claimed.">✓ GitHub account verified</span>' : ''}</div>
    ${profile.bio ? `<p class="curated-bio">${escape(profile.bio)}</p>` : ''}
    ${profile.website ? `<a class="curated-website" href="${escape(profile.website)}" target="_blank" rel="noopener noreferrer nofollow ugc">${escape(new URL(profile.website).hostname)} ↗</a>` : ''}
    ${featured.length ? `<h3>Featured by the developer</h3><div class="featured-projects">${featured.map(repo => `<a href="${escape(repo.html_url)}" target="_blank" rel="noopener noreferrer">${escape(repo.name)} <span>★ ${new Intl.NumberFormat('en-US').format(repo.stargazers_count)}</span></a>`).join('')}</div>` : ''}
    ${!profile.claimed ? '<h3>Make this profile yours.</h3><p>Add your story, link your website, and put your favorite projects first.</p>' : '<p class="claim-note">Claiming verifies control of this GitHub account. Repository ownership and ranking follow the published methodology.</p>'}
    <div id="claim-controls"></div><p id="claim-status" role="status"></p>`;
  const controls = slot.querySelector('#claim-controls');
  if (!enabled || !profile.claimsEnabled) {
    controls.innerHTML = '<span class="claim-coming-soon">Profile claiming is coming soon</span><p class="claim-note">You’ll be able to sign in and connect GitHub to verify your profile.</p>';
    return;
  }
  if (!clerk.user) {
    controls.innerHTML = `<button class="profile-button claim-primary" id="profile-sign-in">${profile.claimed ? 'Sign in to manage your profile' : 'Sign in to claim this profile'} →</button><p class="claim-note">Only the matching GitHub account can claim or edit this profile.</p>`;
    controls.querySelector('button').onclick = () => startSignIn(developer.login);
    return;
  }
  if (!ownedAccount) {
    controls.innerHTML = '<p>Is this you? Connect the matching GitHub account to continue.</p><button class="profile-button" id="connect-github">Connect GitHub in account settings ↗</button>';
    controls.querySelector('button').onclick = accountSettings;
    return;
  }
  controls.innerHTML = `<button class="profile-button claim-primary" id="claim-profile">${profile.claimed ? 'Manage my profile' : 'Claim my profile'} →</button>`;
  controls.querySelector('button').onclick = async event => {
    event.currentTarget.disabled = true;
    const target = slot.querySelector('#claim-status');
    target.textContent = 'Verifying your GitHub account…';
    try {
      // Idempotent claim call also checks that this Clerk account owns the claim.
      const claimed = await api(`/api/profiles/${developer.login}`, 'POST');
      if (turn !== revision) return;
      target.textContent = '';
      controls.innerHTML = editorHTML(developer, claimed);
      controls.querySelector('textarea').focus();
      controls.querySelector('#cancel-profile-edit').onclick = () => renderClaim(developer);
      controls.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const form = e.currentTarget, message = controls.querySelector('#edit-status'), button = form.querySelector('[type="submit"]');
        const data = new FormData(form);
        button.disabled = true; message.textContent = 'Saving…';
        try {
          await api(`/api/profiles/${developer.login}`, 'PATCH', { bio: data.get('bio'), website: data.get('website'), featuredProjects: data.getAll('featured') });
          if (turn !== revision) return;
          await renderClaim(developer);
          const saved = document.getElementById('claim-status');
          if (current === developer && saved) saved.textContent = 'Profile saved.';
        } catch (error) { message.textContent = error.message; button.disabled = false; }
      };
    } catch (error) {
      target.textContent = error.message;
      controls.querySelector('button').disabled = false;
    }
  };
}
function syncAccount() {
  const button = document.getElementById('account-button');
  button.textContent = clerk?.user ? 'My account ↗' : 'Claim your profile';
  document.getElementById('sign-out').hidden = !clerk?.user;
  if (clerk?.user && pendingLogin) {
    const login = pendingLogin; pendingLogin = null;
    sessionStorage.removeItem('starboard-claim-profile');
    openProfile(login);
  } else if (current && document.getElementById('profile-dialog').open) renderClaim(current);
}
document.addEventListener('starboard:profile', event => renderClaim(event.detail));
document.getElementById('sign-out').onclick = async event => {
  event.currentTarget.disabled = true;
  try { closeDialogs(); await clerk.signOut(); status('You have signed out.'); }
  catch { status('Sign-out failed. Please try again.'); }
  finally { document.getElementById('sign-out').disabled = false; syncAccount(); }
};
document.getElementById('account-button').onclick = () => {
  if (clerk?.user) { accountSettings(); return; }
  const dialog = document.getElementById('claim-directory');
  document.getElementById('claim-directory-note').textContent = enabled ? 'Find your profile, then sign in and connect GitHub to claim it.' : 'Claiming is coming soon. Find your profile to explore the projects already listed.';
  dialog.showModal();
};
document.getElementById('close-claim-directory').onclick = () => document.getElementById('claim-directory').close();
document.getElementById('find-profile-form').onsubmit = event => {
  event.preventDefault();
  const login = document.getElementById('claim-login').value.trim().replace(/^@/, '');
  const person = window.starboardDevelopers?.find(d => d.login.toLowerCase() === login.toLowerCase());
  if (!person) { document.getElementById('find-profile-status').textContent = 'That account is not in this curated sample yet.'; return; }
  document.getElementById('claim-directory').close(); openProfile(person.login);
};
function populateDirectory() {
  if (window.starboardDevelopers) document.getElementById('claim-usernames').innerHTML = window.starboardDevelopers.map(d => `<option value="${escape(d.login)}">${escape(d.name)}</option>`).join('');
}
document.addEventListener('starboard:ready', populateDirectory);
populateDirectory();
(async () => {
  try {
    const config = await api('/api/config');
    enabled = config.claimsEnabled;
    if (enabled) {
      clerk = await loadClerk(config.publishableKey);
      let previousUser;
      clerk.addListener(({ user }) => {
        if (previousUser !== user?.id) { previousUser = user?.id; syncAccount(); }
      });
      syncAccount();
    }
  } catch { enabled = false; status('Account features are currently unavailable. You can still browse the leaderboard.'); }
  finally { ready = true; if (window.starboardProfile) renderClaim(window.starboardProfile); }
})();
