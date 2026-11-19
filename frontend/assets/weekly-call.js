(() => {
  'use strict';
  const zone = 'Europe/Berlin';
  const partsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  function parts(date) {
    return Object.fromEntries(partsFormatter.formatToParts(date)
      .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  }
  function berlinInstant(year, month, day, hour, minute) {
    const wall = Date.UTC(year, month - 1, day, hour, minute);
    let value = wall;
    for (let pass = 0; pass < 4; pass++) {
      const p = parts(new Date(value));
      const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
      value += wall - rendered;
    }
    return new Date(value);
  }
  function nextOccurrence(config, now = new Date()) {
    if (!config || config.paused || config.time_zone !== zone) return null;
    const [hour, minute] = String(config.time).split(':').map(Number);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
        !Number.isInteger(minute) || minute < 0 || minute > 59 ||
        !Number.isInteger(config.weekday) || config.weekday < 0 || config.weekday > 6) return null;
    const p = parts(now);
    const anchor = Date.UTC(p.year, p.month - 1, p.day);
    const excluded = new Set(config.skipped_dates || []);
    for (let offset = 0; offset < 370; offset++) {
      const day = new Date(anchor + offset * 86400000);
      if (day.getUTCDay() !== config.weekday) continue;
      const key = day.toISOString().slice(0, 10);
      if (excluded.has(key)) continue;
      const candidate = berlinInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute);
      if (candidate > now) return candidate;
    }
    return null;
  }
  function status(start, now = new Date()) {
    const minutes = Math.ceil((start - now) / 60000);
    if (minutes <= 10) return 'Gleich geht’s los · ' + minutes + ' Min. bis zum Termin';
    if (minutes <= 30) return 'In ' + minutes + ' Minuten';
    if (minutes <= 60) return 'In ' + minutes + ' Minuten';
    const a = parts(start), b = parts(now);
    if (a.year === b.year && a.month === b.month && a.day === b.day) return 'Heute · 20:30 Uhr';
    return 'Nächster Mittwochstermin';
  }
  function invitation(config, start) {
    const date = new Intl.DateTimeFormat('de-DE', { timeZone: zone, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(start);
    return config.title + '\n\n' + date + ' · ' + config.time + ' Uhr deutscher Zeit\n' +
      'Mit ' + config.speakers.join(' und ') + '\n\n' +
      'Jeden Mittwoch – für alle offen.\n' +
      'Zoom: ' + config.url + '\nMeeting-ID: ' + config.meeting_id;
  }
  function calendar(config, start) {
    const p = parts(start);
    const pad = value => String(value).padStart(2, '0');
    const escape = text => String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const local = p.year + pad(p.month) + pad(p.day) + 'T' + pad(p.hour) + pad(p.minute) + '00';
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TAG Record//Community Call//DE',
      'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
      'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE',
      'BEGIN:VEVENT', 'UID:tag-markets-weekly-5599741281@tagrecord',
      'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
      'DTSTART;TZID=Europe/Berlin:' + local, 'RRULE:FREQ=WEEKLY;BYDAY=WE',
      ...(config.skipped_dates || []).map(day => 'EXDATE;TZID=Europe/Berlin:' + day.replace(/-/g, '') + 'T203000'),
      'SUMMARY:' + escape(config.title), 'DESCRIPTION:' + escape('Mit ' + config.speakers.join(' und ') + '\n' + config.url),
      'URL:' + config.url, 'END:VEVENT', 'END:VCALENDAR', ''
    ].join('\r\n');
  }
  function render(config, target) {
    if (!target || !config) return;
    const card = document.createElement('article');
    card.className = 'weekly-call community-item';
    const body = document.createElement('div'); body.className = 'weekly-body';
    const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'UNSER WÖCHENTLICHER COMMUNITY-CALL';
    const heading = document.createElement('h2'); heading.textContent = config.title;
    const rule = document.createElement('p'); rule.className = 'weekly-rule'; rule.textContent = 'Jeden Mittwoch · 20:30 Uhr deutscher Zeit';
    const speakers = document.createElement('p'); speakers.textContent = 'Mit ' + config.speakers.join(' und ');
    const badge = document.createElement('p'); badge.className = 'weekly-badge';
    const next = document.createElement('p'); next.className = 'weekly-next';
    const zoneNote = document.createElement('p'); zoneNote.textContent = 'Europe/Berlin · Sommer- und Winterzeit werden automatisch berücksichtigt.';
    const actions = document.createElement('div'); actions.className = 'weekly-actions';
    const join = document.createElement('a'); join.href = config.url; join.target = '_blank'; join.rel = 'noopener noreferrer'; join.textContent = 'Am Zoom teilnehmen'; join.className = 'btn-primary';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Einladung kopieren'; copy.className = 'btn-outline';
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Im Kalender speichern'; save.className = 'btn-outline';
    actions.append(join, copy, save);
    const note = document.createElement('p'); note.className = 'weekly-copy-note'; note.setAttribute('aria-live', 'polite');
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Einladungstext zum Weiterleiten anzeigen';
    const text = document.createElement('textarea'); text.readOnly = true; text.rows = 9; text.setAttribute('aria-label', 'Einladungstext');
    details.append(summary, text);
    body.append(eyebrow, heading, rule, speakers, badge, next, zoneNote, actions, note, details);
    card.append(body); target.append(card);
    let start;
    function update() {
      start = nextOccurrence(config);
      join.hidden = !start; copy.disabled = !start; save.disabled = !start;
      if (!start) { badge.textContent = 'Serie pausiert'; next.textContent = 'Der nächste Termin wird noch bekannt gegeben.'; text.value = ''; return; }
      badge.textContent = status(start);
      next.textContent = 'Nächster Termin: ' + new Intl.DateTimeFormat('de-DE', { timeZone: zone, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(start) + ' Uhr';
      text.value = invitation(config, start);
    }
    copy.addEventListener('click', async () => {
      let ok = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text.value);
          ok = true;
        } catch (e) {}
      }
      if (!ok) {
        try {
          text.select();
          document.execCommand('copy');
          ok = true;
        } catch (e) {}
      }
      if (ok) {
        note.textContent = '✓ Einladung kopiert! Du kannst sie jetzt in Telegram oder WhatsApp einfügen.';
        note.style.color = '#00e676';
        setTimeout(() => { note.textContent = ''; }, 6000);
      } else {
        details.open = true;
        text.focus();
        text.select();
        note.textContent = 'Bitte den markierten Einladungstext manuell kopieren.';
        note.style.color = 'var(--text-secondary)';
      }
    });
    save.addEventListener('click', () => {
      if (!start) return;
      const url = URL.createObjectURL(new Blob([calendar(config, start)], { type: 'text/calendar;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'TAG_Markets_Call_mittwochs.ics'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    update(); setInterval(update, 30000);
    document.getElementById('calls-empty').hidden = true;
  }
  window.TagWeeklyCall = { nextOccurrence, invitation, calendar, status, render };
})();
