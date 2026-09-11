// Dedicated pages already contain all their public content in HTML.
(() => {
  const data = JSON.parse(document.getElementById('page-data').textContent);
  window.starboardDevelopers = data.developers;
  window.starboardProfile = data.profile;
  document.addEventListener('starboard:open-profile', event => {
    if (data.profile?.login.toLowerCase() === event.detail.toLowerCase()) {
      document.dispatchEvent(new CustomEvent('starboard:profile', { detail: data.profile }));
      document.getElementById('profile-claim').scrollIntoView({ block: 'center' });
    } else {
      location.assign(`/developers/${encodeURIComponent(event.detail.toLowerCase())}/`);
    }
  });
  document.dispatchEvent(new Event('starboard:ready'));
  if (data.profile) document.dispatchEvent(new CustomEvent('starboard:profile', { detail: data.profile }));
  const copy = document.getElementById('copy-profile');
  if (copy) {
    copy.hidden = false;
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.origin + location.pathname);
        document.getElementById('copy-status').textContent = 'Link copied';
      } catch { document.getElementById('copy-status').textContent = 'Copy the URL from your address bar.'; }
    };
  }
})();
