// ============================================================
// Roadmap — big goals for MOS the business, in 3 columns:
// Idea → Doing → Done. Arrows move a goal between columns.
// ============================================================

import { list, add, save, remove } from '../db.js';
import { t } from '../lang.js';
import { esc, openForm, toastError } from '../ui.js';

const COLUMNS = ['idea', 'doing', 'done'];

function fields() {
  return [
    { name: 'title', label: t('f.title'), required: true },
    { name: 'description', label: t('f.description'), type: 'textarea' },
    { name: 'status', label: t('f.status'), type: 'select', options: COLUMNS.map(v => ({ value: v, label: t('road.' + v) })) },
  ];
}

export default {
  id: 'roadmap',
  async render(view, ctx) {
    const goals = await list('roadmap', 'created_at', true);

    view.innerHTML = `
      <div class="toolbar"><button class="btn btn-gold" data-new>+ ${esc(t('road.new'))}</button></div>
      <div class="board">
        ${COLUMNS.map((col, i) => {
          const items = goals.filter(g => g.status === col);
          return `
          <section class="column col-${col}">
            <h2>${esc(t('road.' + col))} <span class="count">${items.length}</span></h2>
            ${items.map(g => `
              <article class="card goal" data-id="${g.id}">
                <button class="goal-main" data-edit>
                  <strong>${esc(g.title)}</strong>
                  ${g.description ? `<p class="muted">${esc(g.description)}</p>` : ''}
                </button>
                <div class="goal-moves">
                  ${i > 0 ? `<button class="icon-btn" data-move="${COLUMNS[i - 1]}" aria-label="${esc(t('road.' + COLUMNS[i - 1]))}">←</button>` : '<span></span>'}
                  ${i < COLUMNS.length - 1 ? `<button class="icon-btn" data-move="${COLUMNS[i + 1]}" aria-label="${esc(t('road.' + COLUMNS[i + 1]))}">→</button>` : ''}
                </div>
              </article>`).join('')}
          </section>`;
        }).join('')}
      </div>`;

    view.querySelector('[data-new]').onclick = () => openForm({
      title: t('road.new'), fields: fields(), values: { status: 'idea' },
      onSave: async v => { await add('roadmap', v); ctx.rerender(); },
    });
    view.querySelectorAll('.goal').forEach(card => {
      const goal = goals.find(g => g.id === card.dataset.id);
      card.querySelector('[data-edit]').onclick = () => openForm({
        title: t('btn.edit'), fields: fields(), values: goal,
        onSave: async v => { await save('roadmap', goal.id, v); ctx.rerender(); },
        onDelete: async () => { await remove('roadmap', goal.id); ctx.rerender(); },
      });
      card.querySelectorAll('[data-move]').forEach(b => {
        b.onclick = async () => {
          try { await save('roadmap', goal.id, { status: b.dataset.move }); ctx.rerender(); }
          catch (err) { toastError(err); }
        };
      });
    });
  },
};
