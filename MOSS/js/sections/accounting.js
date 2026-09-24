// ============================================================
// Accounting — two tabs:
//   Money in / out: every payment and expense, monthly totals,
//                   receipts attached to expenses.
//   Invoices: MOS-2026-001 numbers, PDF, "mark paid".
// Taxes (GST/QST) are OFF until you turn them on in Profile.
// ============================================================

import { list, add, save, remove, getSettings, uploadReceipt, receiptUrl, deleteReceipt } from '../db.js';
import { t, lang } from '../lang.js';
import { esc, fmtDate, fmtMoney, isoDate, round2, openForm, optionsFrom, emptyState, toast, toastError } from '../ui.js';
import { invoicePdf } from '../pdf.js';

let tab = 'money';
let monthKey = isoDate().slice(0, 7); // 'YYYY-MM'

// ---------- taxes ----------
export function taxesFor(subtotal, settings) {
  if (!settings.taxes_on) return { gst: 0, qst: 0 };
  return {
    gst: round2(subtotal * Number(settings.gst_rate) / 100),
    qst: round2(subtotal * Number(settings.qst_rate) / 100),
  };
}

// Next number for a year: MOS-2026-001, MOS-2026-002…
export function nextInvoiceNumber(invoices, year) {
  const prefix = `MOS-${year}-`;
  const max = invoices
    .filter(i => i.number?.startsWith(prefix))
    .reduce((m, i) => Math.max(m, parseInt(i.number.slice(prefix.length), 10) || 0), 0);
  return prefix + String(max + 1).padStart(3, '0');
}

// ---------- money in / out ----------
function moneyFields(settings, type) {
  const f = [
    { name: 'type', label: t('acc.type'), type: 'select', half: true,
      options: [{ value: 'in', label: t('acc.in') }, { value: 'out', label: t('acc.out') }] },
    { name: 'date', label: t('f.date'), type: 'date', required: true, half: true },
    { name: 'amount', label: t('acc.amount'), type: 'number', required: true, step: '0.01' },
    { name: 'category', label: t('acc.category'), half: true },
    { name: 'description', label: t('f.description'), half: true },
  ];
  if (settings.taxes_on) {
    f.push({ name: 'gst', label: t('acc.gst') + ' ($)', type: 'number', step: '0.01', half: true });
    f.push({ name: 'qst', label: t('acc.qst') + ' ($)', type: 'number', step: '0.01', half: true });
  }
  f.push({ name: 'receipt', label: t('acc.receipt'), type: 'file', accept: 'image/*,application/pdf' });
  return f;
}

function openTransaction(tx, settings, ctx, type = 'out') {
  const isNew = !tx;
  openForm({
    title: isNew ? t(type === 'in' ? 'acc.newIn' : 'acc.newOut') : t('btn.edit'),
    fields: moneyFields(settings, type),
    values: tx || { type, date: isoDate() },
    onSave: async v => {
      const { receipt, ...row } = v;
      row.gst = row.gst ?? 0;
      row.qst = row.qst ?? 0;
      if (receipt) {
        const old = tx?.receipt_path;
        row.receipt_path = await uploadReceipt(receipt, ctx.user.id);
        if (old) deleteReceipt(old).catch(() => {});
      }
      if (isNew) await add('transactions', row);
      else await save('transactions', tx.id, row);
      ctx.rerender();
    },
    onDelete: isNew ? null : async () => {
      await remove('transactions', tx.id);
      deleteReceipt(tx.receipt_path).catch(() => {});
      ctx.rerender();
    },
  });
}

function renderMoney(body, txs, settings, ctx) {
  const inMonth = txs.filter(x => x.date.startsWith(monthKey)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const sum = (type, key = 'amount') => round2(inMonth.filter(x => x.type === type).reduce((s, x) => s + Number(x[key] || 0), 0));
  const totalIn = sum('in'), totalOut = sum('out');
  const [y, m] = monthKey.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString(lang() === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' });

  body.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-gold" data-new="in">+ ${esc(t('acc.newIn'))}</button>
      <button class="btn btn-ghost" data-new="out">+ ${esc(t('acc.newOut'))}</button>
      <span class="spacer"></span>
      <button class="icon-btn" data-prev aria-label="Previous month">‹</button>
      <strong class="month-label">${esc(monthLabel)}</strong>
      <button class="icon-btn" data-next aria-label="Next month">›</button>
    </div>
    <div class="stats">
      <div class="stat"><span class="muted">${esc(t('acc.in'))}</span><strong class="text-good">${esc(fmtMoney(totalIn))}</strong></div>
      <div class="stat"><span class="muted">${esc(t('acc.out'))}</span><strong class="text-danger">${esc(fmtMoney(totalOut))}</strong></div>
      <div class="stat"><span class="muted">${esc(t('acc.balance'))}</span><strong>${esc(fmtMoney(totalIn - totalOut))}</strong></div>
      ${settings.taxes_on ? `
      <div class="stat"><span class="muted">${esc(t('acc.taxesCollected'))}</span><strong>${esc(fmtMoney(sum('in', 'gst') + sum('in', 'qst')))}</strong></div>
      <div class="stat"><span class="muted">${esc(t('acc.taxesPaid'))}</span><strong>${esc(fmtMoney(sum('out', 'gst') + sum('out', 'qst')))}</strong></div>` : ''}
    </div>
    ${settings.taxes_on ? '' : `<p class="muted small">${esc(t('acc.taxesOff'))}</p>`}
    ${inMonth.length ? `<ul class="rows">${inMonth.map(x => `
      <li class="row" data-id="${x.id}">
        <button class="row-main" data-edit>
          <span class="row-title">${esc(x.description || x.category || (x.type === 'in' ? t('acc.in') : t('acc.out')))}</span>
          <span class="row-meta">${esc(fmtDate(x.date))}${x.category ? ' · ' + esc(x.category) : ''}</span>
        </button>
        ${x.receipt_path ? `<button class="btn btn-ghost btn-sm" data-receipt>${esc(t('acc.viewReceipt'))}</button>` : ''}
        <strong class="amount ${x.type === 'in' ? 'text-good' : 'text-danger'}">${x.type === 'in' ? '+' : '−'}${esc(fmtMoney(x.amount))}</strong>
      </li>`).join('')}</ul>` : emptyState()}`;

  body.querySelectorAll('[data-new]').forEach(b => { b.onclick = () => openTransaction(null, settings, ctx, b.dataset.new); });
  const shift = k => { const d = new Date(y, m - 1 + k, 1); monthKey = isoDate(d).slice(0, 7); ctx.rerender(); };
  body.querySelector('[data-prev]').onclick = () => shift(-1);
  body.querySelector('[data-next]').onclick = () => shift(1);
  body.querySelectorAll('.row').forEach(li => {
    const tx = txs.find(x => x.id === li.dataset.id);
    li.querySelector('[data-edit]').onclick = () => openTransaction(tx, settings, ctx, tx.type);
    const r = li.querySelector('[data-receipt]');
    if (r) r.onclick = async () => {
      const win = window.open('', '_blank'); // open now so pop-up blockers allow it
      try {
        const url = await receiptUrl(tx.receipt_path);
        if (win) { win.opener = null; win.location = url; } else location.href = url;
      } catch (err) { win?.close(); toastError(err); }
    };
  });
}

// ---------- invoices ----------
function itemsEditor(items) {
  const row = (it = {}) => `
    <div class="item-row">
      <input name="it_desc" placeholder="${esc(t('inv.item'))}" value="${esc(it.description)}" required>
      <input name="it_qty" type="number" step="any" min="0" placeholder="${esc(t('inv.qty'))}" value="${esc(it.qty ?? 1)}" required>
      <input name="it_price" type="number" step="0.01" placeholder="${esc(t('inv.price'))}" value="${esc(it.price ?? '')}" required>
      <button type="button" class="icon-btn" data-rm aria-label="${esc(t('btn.delete'))}">✕</button>
    </div>`;
  return {
    html: `
      <div class="field">
        <label>${esc(t('inv.items'))}</label>
        <div class="items" data-items>${(items.length ? items : [{}]).map(row).join('')}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-additem>${esc(t('inv.addItem'))}</button>
      </div>
      <div class="totals" data-totals></div>`,
    row,
  };
}

function readItems(form) {
  return [...form.querySelectorAll('.item-row')].map(r => ({
    description: r.querySelector('[name=it_desc]').value.trim(),
    qty: Number(r.querySelector('[name=it_qty]').value) || 0,
    price: Number(r.querySelector('[name=it_price]').value) || 0,
  })).filter(i => i.description);
}

function computeTotals(items, settings) {
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.price, 0));
  const { gst, qst } = taxesFor(subtotal, settings);
  return { subtotal, gst, qst, total: round2(subtotal + gst + qst) };
}

function openInvoice(inv, invoices, clients, settings, ctx) {
  const isNew = !inv;
  const editor = itemsEditor(inv?.items || []);
  const due = new Date(); due.setDate(due.getDate() + 30);
  const form = openForm({
    title: isNew ? t('inv.new') : `${t('btn.edit')} ${inv.number}`,
    fields: [
      { name: 'client_id', label: t('f.client'), type: 'select', options: optionsFrom(clients), required: true },
      { name: 'issue_date', label: t('inv.issue'), type: 'date', required: true, half: true },
      { name: 'due_date', label: t('inv.due'), type: 'date', half: true },
      { name: 'notes', label: t('f.notes'), type: 'textarea' },
    ],
    values: inv || { issue_date: isoDate(), due_date: isoDate(due) },
    extraHtml: editor.html,
    onSave: async (v, formEl) => {
      const items = readItems(formEl);
      if (!items.length) throw new Error(t('inv.items') + '?');
      const row = { ...v, items, ...computeTotals(items, settings) };
      if (isNew) {
        row.number = nextInvoiceNumber(invoices, row.issue_date.slice(0, 4));
        await add('invoices', row);
      } else {
        await save('invoices', inv.id, row);
      }
      ctx.rerender();
    },
    onDelete: isNew ? null : async () => { await remove('invoices', inv.id); ctx.rerender(); },
  });

  const itemsBox = form.querySelector('[data-items]');
  const refresh = () => {
    const tt = computeTotals(readItems(form), settings);
    form.querySelector('[data-totals]').innerHTML = `
      <div><span>${esc(t('inv.subtotal'))}</span><span>${esc(fmtMoney(tt.subtotal))}</span></div>
      ${settings.taxes_on ? `
      <div><span>${esc(t('acc.gst'))} (${esc(settings.gst_rate)}%)</span><span>${esc(fmtMoney(tt.gst))}</span></div>
      <div><span>${esc(t('acc.qst'))} (${esc(settings.qst_rate)}%)</span><span>${esc(fmtMoney(tt.qst))}</span></div>` : ''}
      <div class="grand"><span>${esc(t('inv.total'))}</span><span>${esc(fmtMoney(tt.total))}</span></div>`;
  };
  form.querySelector('[data-additem]').onclick = () => { itemsBox.insertAdjacentHTML('beforeend', editor.row()); refresh(); };
  itemsBox.addEventListener('click', e => {
    if (e.target.closest('[data-rm]') && itemsBox.children.length > 1) { e.target.closest('.item-row').remove(); refresh(); }
  });
  itemsBox.addEventListener('input', refresh);
  refresh();
}

async function markPaid(inv, clients, ctx) {
  try {
    await save('invoices', inv.id, { status: 'paid' });
    await add('transactions', {
      type: 'in', date: isoDate(), amount: inv.total, gst: inv.gst, qst: inv.qst,
      category: t('acc.tabInvoices'), invoice_id: inv.id,
      description: `${inv.number} · ${clients.find(c => c.id === inv.client_id)?.name || ''}`,
    });
    toast(t('inv.paidNote'));
    ctx.rerender();
  } catch (err) { toastError(err); }
}

function renderInvoices(body, invoices, clients, settings, ctx) {
  const sorted = [...invoices].sort((a, b) => (a.number < b.number ? 1 : -1));
  const clientName = id => clients.find(c => c.id === id)?.name || '—';
  const today = isoDate();
  body.innerHTML = `
    <div class="toolbar"><button class="btn btn-gold" data-new>+ ${esc(t('inv.new'))}</button></div>
    ${sorted.length ? `<ul class="rows">${sorted.map(i => {
      const late = i.status === 'unpaid' && i.due_date && i.due_date < today;
      return `
      <li class="row" data-id="${i.id}">
        <button class="row-main" data-edit>
          <span class="row-title">${esc(i.number)} · ${esc(clientName(i.client_id))}</span>
          <span class="row-meta">${esc(fmtDate(i.issue_date))}${i.due_date ? ` · ${esc(t('inv.due'))} <span class="${late ? 'text-danger' : ''}">${esc(fmtDate(i.due_date))}</span>` : ''}</span>
        </button>
        <span class="badge ${i.status === 'paid' ? 'badge-good' : late ? 'badge-danger' : 'badge-warn'}">${esc(t('inv.' + i.status))}</span>
        <strong class="amount">${esc(fmtMoney(i.total))}</strong>
        <button class="btn btn-ghost btn-sm" data-pdf>${esc(t('inv.pdf'))}</button>
        ${i.status === 'unpaid' ? `<button class="btn btn-ghost btn-sm" data-paid>${esc(t('inv.markPaid'))}</button>` : ''}
      </li>`;
    }).join('')}</ul>` : emptyState()}`;

  body.querySelector('[data-new]').onclick = () => {
    if (!clients.length) { toast(lang() === 'fr' ? "Ajoute d'abord un client (Apps et sites web → Clients)." : 'Add a client first (Apps & Websites → Clients).', 'err'); return; }
    openInvoice(null, invoices, clients, settings, ctx);
  };
  body.querySelectorAll('.row').forEach(li => {
    const inv = invoices.find(x => x.id === li.dataset.id);
    li.querySelector('[data-edit]').onclick = () => openInvoice(inv, invoices, clients, settings, ctx);
    li.querySelector('[data-pdf]').onclick = () => {
      try { invoicePdf(inv, clients.find(c => c.id === inv.client_id), settings); }
      catch (err) { toastError(err); }
    };
    const paid = li.querySelector('[data-paid]');
    if (paid) paid.onclick = () => markPaid(inv, clients, ctx);
  });
}

export default {
  id: 'accounting',
  async render(view, ctx) {
    const [txs, invoices, clients, settings] = await Promise.all([
      list('transactions', 'date', false), list('invoices'), list('clients', 'name', true), getSettings(),
    ]);
    const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;
    view.innerHTML = `
      <div class="tabs" role="tablist">
        <button role="tab" class="tab ${tab === 'money' ? 'on' : ''}" data-tab="money">${esc(t('acc.tabMoney'))}</button>
        <button role="tab" class="tab ${tab === 'invoices' ? 'on' : ''}" data-tab="invoices">${esc(t('acc.tabInvoices'))}
          ${unpaidCount ? `<span class="count warn">${unpaidCount}</span>` : ''}</button>
      </div>
      <div data-body></div>`;
    view.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { tab = b.dataset.tab; ctx.rerender(); }; });
    const body = view.querySelector('[data-body]');
    if (tab === 'money') renderMoney(body, txs, settings, ctx);
    else renderInvoices(body, invoices, clients, settings, ctx);
  },
};
