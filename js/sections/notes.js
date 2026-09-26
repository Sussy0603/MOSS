// ============================================================
// Notes — rich text (Quill editor), tags, search, pin.
// Notes save by themselves 1 second after you stop typing.
// ============================================================

import { list, add, save, remove, isOffline } from '../db.js';
import { t } from '../lang.js';
import { esc, cleanHtml, fmtDate, emptyState, toast, toastError } from '../ui.js';

let selectedId = null;
let search = '';
let tagFilter = '';
// Saves the open note (set by mountEditor). Called before anything re-draws the page.
let flushCurrent = async () => {};

const plain = html => { const d = document.createElement('div'); d.innerHTML = cleanHtml(html); return d.textContent || ''; };
const parseTags = s => [...new Set(s.split(',').map(x => x.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];

export default {
  id: 'notes',
  async render(view, ctx) {
    const notes = await list('notes', 'updated_at', false);
    if (selectedId && !notes.find(n => n.id === selectedId)) selectedId = null;

    view.innerHTML = `
      <div class="notes ${selectedId ? 'has-open' : ''}">
        <div class="notes-list">
          <div class="toolbar">
            <button class="btn btn-gold" data-new>+ ${esc(t('notes.new'))}</button>
          </div>
          <input type="search" class="search" placeholder="${esc(t('search'))}" value="${esc(search)}" data-search>
          <div class="tags" data-tagbar></div>
          <ul class="note-items" data-items></ul>
        </div>
        <div class="notes-editor">${selectedId ? '' : emptyState(t('notes.pick'))}</div>
      </div>`;

    // Redraws only the tag chips + the list (the search box and editor stay put)
    const drawList = () => {
      const allTags = [...new Set(notes.flatMap(n => n.tags || []))].sort();
      if (tagFilter && !allTags.includes(tagFilter)) tagFilter = '';
      const q = search.toLowerCase();
      const shown = notes
        .filter(n => !tagFilter || (n.tags || []).includes(tagFilter))
        .filter(n => !q || (n.title + ' ' + plain(n.body) + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q))
        .sort((a, b) => (b.pinned - a.pinned) || (a.updated_at < b.updated_at ? 1 : -1));

      const bar = view.querySelector('[data-tagbar]');
      bar.innerHTML = `
        <button class="tag ${!tagFilter ? 'on' : ''}" data-tag="">${esc(t('all'))}</button>
        ${allTags.map(tag => `<button class="tag ${tag === tagFilter ? 'on' : ''}" data-tag="${esc(tag)}">#${esc(tag)}</button>`).join('')}`;
      view.querySelector('[data-items]').innerHTML = shown.map(n => `
        <li><button class="note-item ${n.id === selectedId ? 'active' : ''}" data-open="${n.id}">
          <span class="row-title">${n.pinned ? '📌 ' : ''}${esc(n.title || t('notes.untitled'))}</span>
          <span class="row-meta">${esc(fmtDate(n.updated_at))} ${(n.tags || []).map(x => '#' + esc(x)).join(' ')}</span>
          <span class="note-snippet">${esc(plain(n.body).slice(0, 90))}</span>
        </button></li>`).join('') || `<li>${emptyState()}</li>`;

      bar.querySelectorAll('[data-tag]').forEach(b => { b.onclick = () => { tagFilter = b.dataset.tag; drawList(); }; });
      view.querySelectorAll('[data-open]').forEach(b => {
        b.onclick = async () => { await flushCurrent(); selectedId = b.dataset.open; ctx.rerender(); };
      });
    };
    drawList();

    view.querySelector('[data-new]').onclick = async () => {
      try {
        await flushCurrent();
        const n = await add('notes', { title: '', body: '', tags: tagFilter ? [tagFilter] : [] });
        selectedId = n.id;
        ctx.rerender();
      } catch (err) { toastError(err); }
    };
    view.querySelector('[data-search]').oninput = e => { search = e.target.value; drawList(); };

    flushCurrent = async () => {};
    const note = notes.find(n => n.id === selectedId);
    if (note) mountEditor(view.querySelector('.notes-editor'), note, ctx, drawList);
  },
};

function mountEditor(box, note, ctx, drawList) {
  box.innerHTML = `
    <div class="editor-top">
      <button class="btn btn-ghost btn-sm back-btn" data-back>${esc(t('notes.back'))}</button>
      <span class="spacer"></span>
      <span class="muted save-state" data-state></span>
      <button class="btn btn-ghost btn-sm" data-pin>${esc(note.pinned ? t('notes.unpin') : t('notes.pin'))}</button>
      <button class="btn btn-danger btn-sm" data-del>${esc(t('btn.delete'))}</button>
    </div>
    <input class="note-title" data-title placeholder="${esc(t('notes.untitled'))}" value="${esc(note.title)}">
    <input class="note-tags" data-tags placeholder="${esc(t('notes.tags'))}" value="${esc((note.tags || []).join(', '))}">
    <div class="quill-box"><div data-quill></div></div>`;

  const quill = new window.Quill(box.querySelector('[data-quill]'), {
    theme: 'snow',
    readOnly: isOffline(),
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link', 'blockquote', 'code-block'],
        ['clean'],
      ],
    },
  });
  quill.setContents(quill.clipboard.convert({ html: cleanHtml(note.body) }), 'silent');

  const state = box.querySelector('[data-state]');
  let timer = null;
  let dirty = false;

  const flush = async () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    state.textContent = '…';
    try {
      const changes = {
        title: box.querySelector('[data-title]').value.trim(),
        tags: parseTags(box.querySelector('[data-tags]').value),
        body: cleanHtml(quill.root.innerHTML),
      };
      const saved = await save('notes', note.id, changes);
      Object.assign(note, saved);
      drawList();
      state.textContent = '✓ ' + t('saved');
    } catch (err) { dirty = true; state.textContent = ''; toastError(err); }
  };
  flushCurrent = flush;
  const later = () => { dirty = true; state.textContent = '…'; clearTimeout(timer); timer = setTimeout(flush, 1000); };

  quill.on('text-change', (_d, _o, source) => { if (source === 'user') later(); });
  box.querySelector('[data-title]').oninput = later;
  box.querySelector('[data-tags]').oninput = later;

  box.querySelector('[data-back]').onclick = async () => { await flush(); selectedId = null; ctx.rerender(); };
  box.querySelector('[data-pin]').onclick = async () => {
    try { await flush(); await save('notes', note.id, { pinned: !note.pinned }); ctx.rerender(); }
    catch (err) { toastError(err); }
  };
  box.querySelector('[data-del]').onclick = async () => {
    if (!confirm(t('confirm.delete'))) return;
    try { clearTimeout(timer); await remove('notes', note.id); selectedId = null; toast(t('deleted')); ctx.rerender(); }
    catch (err) { toastError(err); }
  };

  // Save before leaving the page or switching section
  window.addEventListener('hashchange', flush, { once: true });
  window.addEventListener('beforeunload', flush, { once: true });
}
