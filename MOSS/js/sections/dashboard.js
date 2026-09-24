// ============================================================
// Dashboard — today at a glance. Reads from every other table.
// 4 cards: coming up · due or overdue · this month · renewals.
// ============================================================

import { list } from '../db.js';
import { t, lang } from '../lang.js';
import { esc, fmtDate, fmtDateTime, fmtMoney, isoDate, daysBetween, round2 } from '../ui.js';
import { occurrences } from './appointments.js';

export default {
  id: 'dashboard',
  async render(view) {
    const [appts, todos, txs, invoices, sites] = await Promise.all([
      list('appointments', 'starts_at', true), list('todos'), list('transactions', 'date', false), list('invoices'), list('sites', 'name', true),
    ]);
    const today = isoDate();
    const month = today.slice(0, 7);

    const now = new Date();
    const inTwoWeeks = new Date(); inTwoWeeks.setDate(now.getDate() + 14);
    const coming = occurrences(appts, now, inTwoWeeks).slice(0, 5);

    const due = todos.filter(x => !x.done && x.due_date && x.due_date <= today)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).slice(0, 6);

    const monthTx = txs.filter(x => x.date.startsWith(month));
    const sum = type => round2(monthTx.filter(x => x.type === type).reduce((s, x) => s + Number(x.amount), 0));
    const moneyIn = sum('in'), moneyOut = sum('out');
    const unpaid = invoices.filter(i => i.status === 'unpaid');
    const unpaidTotal = round2(unpaid.reduce((s, i) => s + Number(i.total), 0));

    const renewals = sites.flatMap(s => [
      s.domain_renewal && { site: s, kind: t('sites.domainRenewal'), date: s.domain_renewal },
      s.hosting_renewal && { site: s, kind: t('sites.hostingRenewal'), date: s.hosting_renewal },
    ].filter(Boolean)).filter(r => daysBetween(today, r.date) <= 30).sort((a, b) => (a.date < b.date ? -1 : 1));

    const clear = `<p class="muted">✓ ${esc(t('dash.allClear'))}</p>`;
    const hello = new Date().toLocaleDateString(lang() === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long', day: 'numeric', month: 'long' });

    view.innerHTML = `
      <p class="hello">${esc(t('dash.hello'))} · <span class="muted">${esc(hello)}</span></p>
      <div class="dash">
        <a class="card dash-card" href="#/appointments">
          <h2>${esc(t('dash.appointments'))}</h2>
          ${coming.length ? `<ul class="mini">${coming.map(o => `<li><strong>${esc(o.appt.title)}</strong><span class="muted">${esc(fmtDateTime(o.start))}</span></li>`).join('')}</ul>` : clear}
        </a>
        <a class="card dash-card" href="#/todos">
          <h2>${esc(t('dash.todos'))} ${due.length ? `<span class="count warn">${due.length}</span>` : ''}</h2>
          ${due.length ? `<ul class="mini">${due.map(x => `<li><strong>${esc(x.title)}</strong><span class="${x.due_date < today ? 'text-danger' : 'muted'}">${esc(fmtDate(x.due_date))}</span></li>`).join('')}</ul>` : clear}
        </a>
        <a class="card dash-card" href="#/accounting">
          <h2>${esc(t('dash.money'))}</h2>
          <div class="money-row"><span class="muted">${esc(t('acc.in'))}</span><strong class="text-good">${esc(fmtMoney(moneyIn))}</strong></div>
          <div class="money-row"><span class="muted">${esc(t('acc.out'))}</span><strong class="text-danger">${esc(fmtMoney(moneyOut))}</strong></div>
          <div class="money-row total"><span>${esc(t('acc.balance'))}</span><strong>${esc(fmtMoney(moneyIn - moneyOut))}</strong></div>
          ${unpaid.length ? `<p class="muted small">${unpaid.length} ${esc(t('dash.unpaid'))} · ${esc(fmtMoney(unpaidTotal))}</p>` : ''}
        </a>
        <a class="card dash-card" href="#/sites">
          <h2>${esc(t('dash.renewals'))} ${renewals.length ? `<span class="count warn">${renewals.length}</span>` : ''}</h2>
          ${renewals.length ? `<ul class="mini">${renewals.map(r => `<li><strong>${esc(r.site.name)}</strong><span class="${r.date < today ? 'text-danger' : 'muted'}">${esc(r.kind)} · ${esc(fmtDate(r.date))}</span></li>`).join('')}</ul>` : clear}
        </a>
      </div>`;
  },
};
