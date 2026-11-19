(() => {
  const tabs = [...document.querySelectorAll('.zoom-tab')];
  function activate(tab) {
    tabs.forEach(button => {
      const selected = button === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.dataset.section).hidden = !selected;
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      activate(next); next.focus();
    });
  });
  function activateHash() {
    if (tabs.length) activate(location.hash === '#aufzeichnungen' ? document.getElementById('tab-recordings') : tabs[0]);
  }
  activateHash();
  window.addEventListener('hashchange', activateHash);
  function safeLink(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
    catch { return null; }
  }
  function render(items, targetId, emptyId, recording) {
    const target = document.getElementById(targetId);
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const url = safeLink(item.url);
      if (!item.title || !url) return;
      const card = document.createElement('article'); card.className = 'community-item';
      if (recording) {
        const order = document.createElement('p'); order.className = 'eyebrow';
        order.textContent = 'Aufzeichnung ' + (index + 1); card.append(order);
      }
      const heading = document.createElement('h2'); heading.textContent = item.title;
      const details = document.createElement('p'); details.textContent = [item.date, item.time, item.language].filter(Boolean).join(' · ');
      const description = document.createElement('p'); description.textContent = item.description || '';
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = recording ? 'Aufzeichnung ansehen' : 'Am Zoom teilnehmen';
      card.append(heading, details, description, link); target.append(card);
    });
    document.getElementById(emptyId).hidden = target.childElementCount > 0;
  }
  fetch('/api/zooms', { cache: 'no-cache' }).then(response => {
    if (!response.ok) throw new Error('Zoom-Datei nicht erreichbar');
    return response.json();
  }).then(data => {
    render(data.calls, 'call-list', 'calls-empty', false);
    if (data.recurring_call && window.TagWeeklyCall) {
      window.TagWeeklyCall.render(data.recurring_call, document.getElementById('call-list'));
    }
    render(data.recordings, 'recording-list', 'recordings-empty', true);
  }).catch(() => {
    document.querySelectorAll('.zoom-empty p').forEach(p => { p.textContent = 'Der Zoom-Bereich ist derzeit nicht erreichbar. Bitte versucht es später erneut.'; });
  });
})();
