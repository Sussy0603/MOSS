// ============================================================
// Apps & Websites — the sites you manage, plus your clients.
// "Check now" asks the site to answer. A browser can only tell
// "it answers" or "it doesn't" — not WHY it's broken.
// ============================================================

import { list, add, save, remove, isOffline } from '../db.js';
import { t } from '../lang.js';
import { esc, safeUrl, fmtDate, fmtDateTime, fmtMoney, isoDate, daysBetween, openForm, optionsFrom, emptyState, toastError } from '../ui.js';

let tab = 'sites';

function siteFields(clients) {
  return [
    { name: 'name', label: t('f.name'), required: true },
    { name: 'client_id', label: t('f.client'), type: 'select', options: optionsFrom(clients), half: true },
    { name: 'price', label: t('sites.price'), type: 'number', half: true },
    { name: 'url', label: t('sites.url') },
    { name: 'admin_url', label: t('sites.adminUrl'), half: true },
    { name: 'host', label: t('sites.host'), half: true },
    { name: 'domain_renewal', label: t('sites.domainRenewal'), type: 'date', half: true },
    { name: 'hosting_renewal', label: t('sites.hostingRenewal'), type: 'date', half: true },
    { name: 'notes', label: t('f.notes'), type: 'textarea', hint: t('sites.noPasswords') },
  ];
}
function clientFields() {
  return [
    { name: 'name', label: t('f.name'), required: true },
    { name: 'email', label: t('f.email'), type: 'email', half: true },
    { name: 'phone', label: t('f.phone'), type: 'tel', half: true },
    { name: 'notes', label: t('f.notes'), type: 'textarea' },
  ];
}

// Does the site answer? (no-cors: we can't read the reply, only that one came back)
export async function checkSite(url) {
  const href = safeUrl(url);
  if (!href) return 'down';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    await fetch(href, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return 'up';
  } catch { return 'down'; }
  finally { clearTimeout(timer); }
}

function renewalBadge(date) {
  if (!date) return '';
  const days = daysBetween(isoDate(), date);
  const cls = days < 0 ? 'badge-danger' : days <= 30 ? 'badge-warn' : 'badge-soft';
  return `<span class="badge ${cls}">${esc(fmtDate(date))}</span>`;
}

export default {
  id: 'sites',
  async render(view, ctx) {
    const [sites, clients] = await Promise.all([list('sites', 'name', true), list('clients', 'name', true)]);
    const clientName = id => clients.find(c => c.id === id)?.name || '';

    view.innerHTML = `
      <div class="tabs" role="tablist">
        <button role="tab" class="tab ${tab === 'sites' ? 'on' : ''}" data-tab="sites">${esc(t('sites.tabSites'))} <span class="count">${sites.length}</span></button>
        <button role="tab" class="tab ${tab === 'clients' ? 'on' : ''}" data-tab="clients">${esc(t('sites.tabClients'))} <span class="count">${clients.length}</span></button>
      </div>
      <div data-body></div>`;
    view.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { tab = b.dataset.tab; ctx.rerender(); }; });
    const body = view.querySelector('[data-body]');

    if (tab === 'clients') {
      body.innerHTML = `
        <div class="toolbar"><button class="btn btn-gold" data-new>+ ${esc(t('clients.new'))}</button></div>
        ${clients.length ? `<ul class="rows">${clients.map(c => `
          <li class="row" data-id="${c.id}"><button class="row-main" data-edit>
            <span class="row-title">${esc(c.name)}</span>
            <span class="row-meta">${[c.email, c.phone].filter(Boolean).map(esc).join(' · ')}
              · ${sites.filter(s => s.client_id === c.id).length} ${esc(t('sites.tabSites').toLowerCase())}</span>
          </button></li>`).join('')}</ul>` : emptyState()}`;
      body.querySelector('[data-new]').onclick = () => openForm({
        title: t('clients.new'), fields: clientFields(),
        onSave: async v => { await add('clients', v); ctx.rerender(); },
      });
      body.querySelectorAll('.row').forEach(li => {
        const c = clients.find(x => x.id === li.dataset.id);
        li.querySelector('[data-edit]').onclick = () => openForm({
          title: t('btn.edit'), fields: clientFields(), values: c,
          onSave: async v => { await save('clients', c.id, v); ctx.rerender(); },
          onDelete: async () => { await remove('clients', c.id); ctx.rerender(); },
        });
      });
      return;
    }

    body.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-gold" data-new>+ ${esc(t('sites.new'))}</button>
        <span class="muted small">${esc(t('sites.checkNote'))}</span>
      </div>
      ${sites.length ? `<div class="grid">${sites.map(s => {
        const url = safeUrl(s.url), admin = safeUrl(s.admin_url);
        const status = s.last_status || 'unknown';
        return `
        <article class="card site" data-id="${s.id}">
          <div class="site-head">
            <span class="dot dot-${status}" title="${esc(t('sites.' + status))}"></span>
            <h3>${esc(s.name)}</h3>
            <button class="icon-btn" data-edit aria-label="${esc(t('btn.edit'))}">✎</button>
          </div>
          ${clientName(s.client_id) ? `<div class="muted">${esc(clientName(s.client_id))}${s.price != null ? ' · ' + esc(fmtMoney(s.price)) : ''}</div>` : (s.price != null ? `<div class="muted">${esc(fmtMoney(s.price))}</div>` : '')}
          <div class="site-links">
            ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}
            ${admin ? `<a href="${esc(admin)}" target="_blank" rel="noopener noreferrer">Admin ↗</a>` : ''}
          </div>
          <dl class="kv">
            ${s.host ? `<dt>${esc(t('sites.host'))}</dt><dd>${esc(s.host)}</dd>` : ''}
            ${s.domain_renewal ? `<dt>${esc(t('sites.domainRenewal'))}</dt><dd>${renewalBadge(s.domain_renewal)}</dd>` : ''}
            ${s.hosting_renewal ? `<dt>${esc(t('sites.hostingRenewal'))}</dt><dd>${renewalBadge(s.hosting_renewal)}</dd>` : ''}
          </dl>
          <div class="site-foot">
            <span class="muted small">${esc(t('sites.' + status))}${s.last_check ? ' · ' + esc(fmtDateTime(s.last_check)) : ''}</span>
            ${url ? `<button class="btn btn-ghost btn-sm" data-check>${esc(t('sites.check'))}</button>` : ''}
          </div>
        </article>`;
      }).join('')}</div>` : emptyState()}`;

    body.querySelector('[data-new]').onclick = () => openForm({
      title: t('sites.new'), fields: siteFields(clients),
      onSave: async v => { await add('sites', v); ctx.rerender(); },
    });
    body.querySelectorAll('.site').forEach(card => {
      const s = sites.find(x => x.id === card.dataset.id);
      card.querySelector('[data-edit]').onclick = () => openForm({
        title: t('btn.edit'), fields: siteFields(clients), values: s,
        onSave: async v => { await save('sites', s.id, v); ctx.rerender(); },
        onDelete: async () => { await remove('sites', s.id); ctx.rerender(); },
      });
      const btn = card.querySelector('[data-check]');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = '…';
        const status = await checkSite(s.url);
        try {
          if (!isOffline()) await save('sites', s.id, { last_status: status, last_check: new Date().toISOString() });
          ctx.rerender();
        } catch (err) { toastError(err); btn.disabled = false; }
      };
    });
  },
};
