// The legacy workbook page has no canonical, scoped cache contract. Its source
// stays intact for explicit offline migration; hosted access uses ATLAS Reports.
(() => {
  const central = window.ATLAS_CENTRAL;
  const showUnavailable = () => {
    const root = document.getElementById('app');
    root.replaceChildren();
    const message = document.createElement('p');
    message.textContent = 'This legacy financial workspace has no verified data for the current account. Open ATLAS Reports to use authorized financial records. Existing browser migration data has been retained.';
    const link = document.createElement('a');
    link.href = './index.html?tab=8'; link.textContent = 'Open ATLAS Reports';
    root.append(message,link);
  };
  if (central && !central.getStatus().configured) {
    const source = document.getElementById('atlas-legacy-financial-source');
    const script = document.createElement('script'); script.textContent = source.textContent;
    document.body.append(script);
    return;
  }
  showUnavailable();
  // Validation deliberately grants no access to unbound legacy payloads.
  if (central) void (async () => {
    try {
      await central.refreshSession();
      if (central.getSession()?.user) await central.fetchProfile({claim:false});
    } catch {}
    showUnavailable();
  })();
  window.addEventListener('atlas-central-auth-change',showUnavailable);
})();
