// ============================================================
// Appointments — month calendar + upcoming list.
// Repeating appointments (weekly / monthly) are stored ONCE;
// occurrences() works out every date they land on.
// Google Calendar sync: see js/sync.js (phase 7).
// ============================================================

import { list, add, save, remove, isOffline } from '../db.js';
import { t, lang } from '../lang.js';
import { esc, isoDate, fmtDateTime, fmtTime, openForm, emptyState, toast, toastError } from '../ui.js';
import { syncNow, deleteGoogleEvent } from '../sync.js';

let month = new Date(); month.setDate(1);
let autoSynced = false;

// Every time an appointment happens between `from` and `to` (Dates)
export function occurrences(appts, from, to) {
  const out = [];
  for (const a of appts) {
    const start = new Date(a.starts_at);
    const length = a.ends_at ? new Date(a.ends_at) - start : 0;
    let cur = new Date(start);
    let n = 0;
    while (cur <= to && n < 1000) {
      if (cur >= from || new Date(+cur + length) >= from) out.push({ appt: a, start: new Date(cur), end: length ? new Date(+cur + length) : null });
      if (a.repeat === 'weekly') cur.setDate(cur.getDate() + 7);
      else if (a.repeat === 'monthly') cur = addMonthKeepDay(start, ++n);
      else break;
      if (a.repeat === 'weekly') n++;
    }
  }
  return out.sort((x, y) => x.start - y.start);
}
// Jan 31 + 1 month → Feb 28, not Mar 3
function addMonthKeepDay(start, k) {
  const d = new Date(start);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + k);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

function fields() {
  return [
    { name: 'title', label: t('f.title'), required: true },
    { name: 'starts_at', label: t('appt.start'), type: 'datetime', required: true, half: true },
    { name: 'ends_at', label: t('appt.end'), type: 'datetime', half: true },
    { name: 'location', label: t('appt.location') },
    { name: 'repeat', label: t('f.repeat'), type: 'select',
      options: ['none', 'weekly', 'monthly'].map(v => ({ value: v, label: t('repeat.' + v) })) },
    { name: 'notes', label: t('f.notes'), type: 'textarea' },
  ];
}

function validate(v) {
  if (v.ends_at && v.ends_at < v.starts_at) throw new Error(lang() === 'fr' ? 'La fin est avant le début.' : 'The end is before the start.');
  return v;
}

export function openAppointment(appt, ctx, defaults = {}) {
  if (!appt) {
    return openForm({
      title: t('appt.new'), fields: fields(), values: { repeat: 'none', ...defaults },
      onSave: async v => { await add('appointments', validate(v)); ctx.rerender(); },
    });
  }
  openForm({
    title: t('btn.edit'), fields: fields(), values: appt,
    onSave: async v => { await save('appointments', appt.id, validate(v)); ctx.rerender(); },
    onDelete: async () => {
      await deleteGoogleEvent(appt.google_event_id);
      await remove('appointments', appt.id);
      ctx.rerender();
    },
  });
}

async function runSync(ctx, silent = false) {
  const btn = document.querySelector('[data-sync]');
  if (btn) { btn.disabled = true; btn.textContent = t('appt.syncing'); }
  try {
    const r = await syncNow();
    if (!silent) toast(`${t('appt.synced')} (↑${r.pushed ?? 0} ↓${r.pulled ?? 0})`);
    if (r.pushed || r.pulled || r.removed) ctx.rerender();
  } catch (err) {
    if (!silent) toastError(err);
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = t('appt.sync'); }
  }
}

export default {
  id: 'appointments',
  async render(view, ctx) {
    const appts = await list('appointments', 'starts_at', true);
    const locale = lang() === 'fr' ? 'fr-CA' : 'en-CA';

    // Month grid: starts on the Sunday before the 1st, 6 weeks
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(first); gridStart.setDate(1 - first.getDay());
    const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
    const inGrid = occurrences(appts, gridStart, gridEnd);
    const byDay = {};
    inGrid.forEach(o => { (byDay[isoDate(o.start)] ||= []).push(o); });

    const now = new Date();
    const later = new Date(); later.setDate(later.getDate() + 60);
    const upcoming = occurrences(appts, now, later).slice(0, 12);
    const today = isoDate();

    const dayNames = [...Array(7)].map((_, i) => new Date(2024, 8, 1 + i).toLocaleDateString(locale, { weekday: 'short' }));
    const days = [...Array(42)].map((_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });

    view.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-gold" data-new>+ ${esc(t('appt.new'))}</button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" data-sync ${isOffline() ? 'disabled' : ''}>${esc(t('appt.sync'))}</button>
      </div>
      <div class="cal-layout">
        <section class="card cal">
          <div class="cal-head">
            <button class="icon-btn" data-prev aria-label="Previous month">‹</button>
            <h2>${esc(first.toLocaleDateString(locale, { month: 'long', year: 'numeric' }))}</h2>
            <button class="icon-btn" data-next aria-label="Next month">›</button>
            <button class="btn btn-ghost btn-sm" data-today>${esc(t('appt.today'))}</button>
          </div>
          <div class="cal-grid">
            ${dayNames.map(n => `<div class="cal-dow">${esc(n)}</div>`).join('')}
            ${days.map(d => {
              const key = isoDate(d);
              const evs = byDay[key] || [];
              return `<div class="cal-day ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}" data-day="${key}">
                <span class="cal-num">${d.getDate()}</span>
                ${evs.slice(0, 3).map(o => `<button class="cal-ev" data-appt="${o.appt.id}" title="${esc(fmtTime(o.start))} ${esc(o.appt.title)}">${esc(o.appt.title)}</button>`).join('')}
                ${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3}</span>` : ''}
              </div>`;
            }).join('')}
          </div>
        </section>
        <section class="card upcoming">
          <h2>${esc(t('appt.upcoming'))}</h2>
          ${upcoming.length ? `<ul class="rows compact">${upcoming.map(o => `
            <li class="row"><button class="row-main" data-appt="${o.appt.id}">
              <span class="row-title">${esc(o.appt.title)}</span>
              <span class="row-meta">${esc(fmtDateTime(o.start))}${o.appt.location ? ' · ' + esc(o.appt.location) : ''}${o.appt.repeat !== 'none' ? ' · ↻' : ''}${o.appt.google_event_id ? ' · G' : ''}</span>
            </button></li>`).join('')}</ul>` : emptyState()}
        </section>
      </div>`;

    view.querySelector('[data-new]').onclick = () => openAppointment(null, ctx);
    view.querySelector('[data-prev]').onclick = () => { month.setMonth(month.getMonth() - 1); ctx.rerender(); };
    view.querySelector('[data-next]').onclick = () => { month.setMonth(month.getMonth() + 1); ctx.rerender(); };
    view.querySelector('[data-today]').onclick = () => { month = new Date(); month.setDate(1); ctx.rerender(); };
    view.querySelector('[data-sync]').onclick = () => runSync(ctx);
    view.querySelectorAll('[data-appt]').forEach(b => {
      b.onclick = e => { e.stopPropagation(); openAppointment(appts.find(a => a.id === b.dataset.appt), ctx); };
    });
    view.querySelectorAll('[data-day]').forEach(cell => {
      cell.onclick = () => openAppointment(null, ctx, { starts_at: new Date(`${cell.dataset.day}T09:00`).toISOString() });
    });

    // Quietly sync once per visit (does nothing if sync isn't set up)
    if (!autoSynced && !isOffline()) { autoSynced = true; runSync(ctx, true); }
  },
};
