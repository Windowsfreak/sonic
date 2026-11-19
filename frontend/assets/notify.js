(() => {
  function build() {
    const social = document.querySelector('.social');
    if (!social) return;
    const german = !window.i18n || window.i18n.lang === 'de';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'notify-btn';
    const label = german ? 'Benachrichtigungen' : 'Notifications';
    button.setAttribute('aria-label', label); button.title = label;
    button.innerHTML = '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="14" fill="#13a596"/><path d="M14 7.2a4.6 4.6 0 0 0-4.6 4.6v3.1l-1.5 2.4c-.3.5 0 1.1.6 1.1h11c.6 0 .9-.6.6-1.1l-1.5-2.4v-3.1A4.6 4.6 0 0 0 14 7.2zm-1.9 12.1a1.9 1.9 0 0 0 3.8 0z" fill="#fff"/></svg>';
    social.insertBefore(button, social.querySelector('.contact-btn'));
    const dialog = document.createElement('dialog'); dialog.className = 'contact-dialog notify-dialog';
    const heading = document.createElement('h2'); heading.textContent = label;
    const note = document.createElement('p');
    note.textContent = german ? 'Push-Benachrichtigungen sind für unsere eigene Seite noch nicht eingerichtet. Die Vorschau fragt keine Browser-Erlaubnis ab und versendet keine Nachrichten.' : 'Push notifications have not been configured for our own site. This preview does not request browser permission or send messages.';
    const form = document.createElement('form'); form.method = 'dialog';
    const close = document.createElement('button'); close.className = 'contact-close'; close.textContent = german ? 'Schließen' : 'Close';
    form.append(close); dialog.append(heading, note, form); document.body.append(dialog);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    button.addEventListener('click', () => dialog.showModal());
  }
  document.addEventListener('DOMContentLoaded', () => (window.i18n ? window.i18n.ready : Promise.resolve()).then(build));
})();
