(() => {
  function start() {
    const links = document.querySelector('.footer-links');
    if (!links) return;
    const german = !window.i18n || window.i18n.lang === 'de';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'footer-cookies';
    button.textContent = german ? 'Cookie-Einstellungen' : 'Cookie settings';
    const dialog = document.createElement('dialog'); dialog.className = 'contact-dialog';
    const heading = document.createElement('h2'); heading.textContent = button.textContent;
    const note = document.createElement('p');
    note.textContent = german ? 'Diese Website verwendet kein Google Analytics und keine Tracking-Cookies. Sprache, ausgewählter Bereich und Zeitzonen werden nur lokal in diesem Browser gespeichert.' : 'This website has no Google Analytics or tracking cookies. Language, selected section and time zones are stored only in this browser.';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'contact-close';
    reset.textContent = german ? 'Lokale Einstellungen zurücksetzen' : 'Reset local preferences';
    reset.addEventListener('click', () => {
      try { ['lang', 'langFlag', 'homeTab', 'tzCustom', 'tzOff', 'consent'].forEach(key => localStorage.removeItem(key)); } catch {}
      location.reload();
    });
    const form = document.createElement('form'); form.method = 'dialog';
    const close = document.createElement('button'); close.className = 'contact-close'; close.textContent = german ? 'Schließen' : 'Close';
    form.append(close); dialog.append(heading, note, reset, form); document.body.append(dialog);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    button.addEventListener('click', () => dialog.showModal()); links.append(button);
  }
  (window.i18n ? window.i18n.ready : Promise.resolve()).then(start);
})();
