// ============================================================
// To-do — personal tasks with due date, priority, repeat,
// and an optional link to a client or site.
// This is the simplest section: read it first to learn the
// pattern (list → render → add / edit / delete) every other
// section repeats.
// ============================================================

import { list, add, save, remove } from '../db.js';
import { t } from '../lang.js';
import { esc, fmtDate, isoDate, nextDate, openForm, optionsFrom, emptyState, toast, toastError } from '../ui.js';

let showDone = false;

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function fields(clients, sites) {
  return [
    { name: 'title', label: t('f.title'), required: true },
    { name: 'due_date', label: t('f.dueDate'), type: 'date', half: true },
    { name: 'priority', label: t('f.priority'), type: 'select', half: true,
      options: ['low', 'medium', 'high'].map(v => ({ value: v, label: t('priority.' + v) })) },
    { name: 'repeat', label: t('f.repeat'), type: 'select',
      options: ['none', 'weekly', 'monthly', 'yearly'].map(v => ({ value: v, label: t('repeat.' + v) })) },
    { name: 'client_id', label: t('f.client'), type: 'select', half: true, options: optionsFrom(clients) },
    { name: 'site_id', label: t('f.site'), type: 'select', half: true, options: optionsFrom(sites) },
  ];
}

function sortTodos(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const da = a.due_date || '9999', db = b.due_date || '9999';
  if (da !== db) return da < db ? -1 : 1;
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
}

export default {
  id: 'todos',
  async render(view, ctx) {
    const [todos, clients, sites] = await Promise.all([list('todos'), list('clients', 'name', true), list('sites', 'name', true)]);
    const today = isoDate();
    const byId = rows => Object.fromEntries(rows.map(r => [r.id, r]));
    const clientById = byId(clients), siteById = byId(sites);
    const visible = todos.filter(x => showDone || !x.done).sort(sortTodos);

    view.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-gold" data-new>+ ${esc(t('todo.new'))}</button>
        <span class="spacer"></span>
        <label class="check"><input type="checkbox" data-showdone ${showDone ? 'checked' : ''}> ${esc(t('todo.showDone'))}</label>
      </div>
      ${visible.length ? `<ul class="rows">${visible.map(x => {
        const overdue = !x.done && x.due_date && x.due_date < today;
        const links = [clientById[x.client_id]?.name, siteById[x.site_id]?.name].filter(Boolean);
        return `
        <li class="row ${x.done ? 'is-done' : ''}" data-id="${x.id}">
          <input type="checkbox" class="big-check" data-toggle ${x.done ? 'checked' : ''} aria-label="Done">
          <button class="row-main" data-edit>
            <span class="row-title">${esc(x.title)}</span>
            <span class="row-meta">
              <span class="pill pri-${x.priority}">${esc(t('priority.' + x.priority))}</span>
              ${x.due_date ? `<span class="${overdue ? 'text-danger' : ''}">${overdue ? esc(t('todo.overdue')) + ' · ' : ''}${esc(fmtDate(x.due_date))}</span>` : ''}
              ${x.repeat !== 'none' ? `<span>↻ ${esc(t('repeat.' + x.repeat))}</span>` : ''}
              ${links.map(l => `<span class="pill">${esc(l)}</span>`).join('')}
            </span>
          </button>
        </li>`;
      }).join('')}</ul>` : emptyState()}`;

    const f = fields(clients, sites);
    view.querySelector('[data-new]').onclick = () => openForm({
      title: t('todo.new'), fields: f, values: { priority: 'medium', repeat: 'none' },
      onSave: async v => { await add('todos', v); ctx.rerender(); },
    });
    view.querySelector('[data-showdone]').onchange = e => { showDone = e.target.checked; ctx.rerender(); };

    view.querySelectorAll('.row').forEach(li => {
      const item = todos.find(x => x.id === li.dataset.id);
      li.querySelector('[data-edit]').onclick = () => openForm({
        title: t('btn.edit'), fields: f, values: item,
        onSave: async v => { await save('todos', item.id, v); ctx.rerender(); },
        onDelete: async () => { await remove('todos', item.id); ctx.rerender(); },
      });
      li.querySelector('[data-toggle]').onchange = async e => {
        try {
          // A repeating task doesn't finish: it jumps to its next date
          if (e.target.checked && item.repeat !== 'none') {
            const next = nextDate(item.due_date || isoDate(), item.repeat);
            await save('todos', item.id, { due_date: next, done: false });
            toast(`${t('todo.nextOn')} ${fmtDate(next)}`);
          } else {
            await save('todos', item.id, { done: e.target.checked });
          }
          ctx.rerender();
        } catch (err) { e.target.checked = !e.target.checked; toastError(err); }
      };
    });
  },
};
