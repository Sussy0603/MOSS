// ============================================================
// Small helpers every section shares:
// safety (esc, safeUrl), formatting, dates, toast, modal forms.
// ============================================================

import { t, lang } from './lang.js';

// ---------- safety ----------
// ALWAYS pass user text through esc() before putting it in innerHTML.
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Only allow http(s) links (blocks javascript: and friends)
export function safeUrl(u) {
  if (!u) return '';
  const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    const url = new URL(withProto);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}
// Clean rich-text HTML from the notes editor
export function cleanHtml(html) {
  return window.DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'code', 'pre', 'span'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'data-list'],
  });
}

// ---------- dates (local time, no surprises) ----------
const pad = n => String(n).padStart(2, '0');
// Date → 'YYYY-MM-DD' in local time
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// 'YYYY-MM-DD' → Date at local midnight
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// ISO timestamp → value for <input type="datetime-local">
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
// Move a date forward by one repeat step
export function nextDate(dateStr, repeat) {
  const d = parseDate(dateStr);
  if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return isoDate(d);
}

const locale = () => (lang() === 'fr' ? 'fr-CA' : 'en-CA');
export function fmtDate(s) {
  if (!s) return '';
  const d = s.length === 10 ? parseDate(s) : new Date(s);
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}
export function fmtMoney(n) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);
}
export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ---------- toast ----------
let toastTimer;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}
export function toastError(err) {
  console.error(err);
  toast(err?.message || t('error.generic'), 'err');
}

// ---------- modal ----------
export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.removeEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }

export function openModal(title, bodyHtml, { wide = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-back">
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">${esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="${esc(t('btn.close'))}">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  root.querySelector('[data-close]').onclick = closeModal;
  root.querySelector('.modal-back').addEventListener('mousedown', e => {
    if (e.target.classList.contains('modal-back')) closeModal();
  });
  document.addEventListener('keydown', escClose);
  return root.querySelector('.modal');
}

// ---------- forms ----------
// fields: [{ name, label, type, options, required, hint, step }]
// type: text | textarea | date | datetime | number | select | checkbox | file | email | url
function fieldHtml(f, value) {
  const id = `f-${f.name}`;
  const req = f.required ? 'required' : '';
  const hint = f.hint ? `<small class="muted">${esc(f.hint)}</small>` : '';
  let input;
  switch (f.type) {
    case 'textarea':
      input = `<textarea id="${id}" name="${f.name}" rows="4" ${req}>${esc(value)}</textarea>`; break;
    case 'select':
      input = `<select id="${id}" name="${f.name}" ${req}>${f.options.map(o =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`; break;
    case 'checkbox':
      return `<label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${value ? 'checked' : ''}> ${esc(f.label)}</label>${hint}`;
    case 'datetime':
      input = `<input type="datetime-local" id="${id}" name="${f.name}" value="${esc(toLocalInput(value))}" ${req}>`; break;
    case 'file':
      input = `<input type="file" id="${id}" name="${f.name}" accept="${esc(f.accept || '')}">`; break;
    case 'number':
      input = `<input type="number" inputmode="decimal" id="${id}" name="${f.name}" value="${esc(value)}" step="${f.step || 'any'}" ${req}>`; break;
    default:
      input = `<input type="${f.type || 'text'}" id="${id}" name="${f.name}" value="${esc(value)}" ${req}>`;
  }
  return `<label for="${id}">${esc(f.label)}</label>${input}${hint}`;
}

// Read a form back into an object with the right types
function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else if (f.type === 'datetime') out[f.name] = el.value ? new Date(el.value).toISOString() : null;
    else if (f.type === 'file') out[f.name] = el.files[0] || null;
    else if (f.type === 'date' || f.type === 'select') out[f.name] = el.value === '' ? null : el.value;
    else out[f.name] = el.value.trim();
  }
  return out;
}

// Opens a form in a modal. onSave gets the values; throw to keep it open.
export function openForm({ title, fields, values = {}, onSave, onDelete, extraHtml = '' }) {
  const modal = openModal(title, `
    <form class="form" novalidate>
      ${fields.map(f => `<div class="field ${f.half ? 'half' : ''}">${fieldHtml(f, values[f.name])}</div>`).join('')}
      ${extraHtml}
      <div class="form-actions">
        ${onDelete ? `<button type="button" class="btn btn-danger" data-del>${esc(t('btn.delete'))}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" data-cancel>${esc(t('btn.cancel'))}</button>
        <button type="submit" class="btn btn-gold">${esc(t('btn.save'))}</button>
      </div>
    </form>`);
  const form = modal.querySelector('form');
  form.querySelector('[data-cancel]').onclick = closeModal;
  form.querySelector('input,textarea,select')?.focus();

  form.onsubmit = async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await onSave(readForm(form, fields), form);
      closeModal();
      toast(t('saved'));
    } catch (err) { toastError(err); }
    finally { btn.disabled = false; }
  };
  if (onDelete) {
    form.querySelector('[data-del]').onclick = async () => {
      if (!confirm(t('confirm.delete'))) return;
      try { await onDelete(); closeModal(); toast(t('deleted')); }
      catch (err) { toastError(err); }
    };
  }
  return form;
}

// Options list for a <select> of clients/sites, with "None" first
export function optionsFrom(rows, labelKey = 'name') {
  return [{ value: '', label: `— ${t('none')} —` }, ...rows.map(r => ({ value: r.id, label: r[labelKey] }))];
}

export function emptyState(text = t('empty')) {
  return `<div class="empty">${esc(text)}</div>`;
}

// Download any text as a file
export function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
