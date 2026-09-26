// ============================================================
// Profile — your account, recent logins, business details,
// the tax switch, language, backup, and log out.
// ============================================================

import { getSettings, saveSettings, exportAll } from '../db.js';
import { t, lang, setLang } from '../lang.js';
import { esc, fmtDateTime, isoDate, downloadFile, toast, toastError } from '../ui.js';
import { logout, loginWithGoogle, calendarStatus } from '../app.js';

const VERSION = 'MOSS 1.1';

export default {
  id: 'profile',
  async render(view, ctx) {
    const s = await getSettings(true);
    const u = ctx.user;
    const meta = u.user_metadata || {};
    const logins = s.recent_logins || [];
    const cal = calendarStatus();
    const calText = !cal ? t('prof.calUnknown')
      : cal.ok ? `✓ ${t('appt.calendarConnected')} · ${fmtDateTime(cal.at)}`
      : `✕ ${t('appt.calendarNotConnected')} — ${cal.detail}`;

    view.innerHTML = `
      <div class="profile">
        <section class="card">
          <h2>${esc(t('prof.account'))}</h2>
          <div class="who">
            ${meta.avatar_url ? `<img src="${esc(meta.avatar_url)}" alt="" class="avatar" referrerpolicy="no-referrer">` : ''}
            <div><strong>${esc(meta.full_name || meta.name || 'Suzy')}</strong><div class="muted">${esc(u.email)}</div></div>
          </div>
          <h3>${esc(t('prof.lastLogins'))}</h3>
          ${logins.length ? `<ul class="mini">${logins.map(l => `<li><span>${esc(fmtDateTime(l.at))}</span><span class="muted">${esc(l.device)}</span></li>`).join('')}</ul>` : `<p class="muted">—</p>`}
          <div class="form-actions">
            <label class="muted">${esc(t('prof.language'))}
              <select data-lang>
                <option value="en" ${lang() === 'en' ? 'selected' : ''}>English</option>
                <option value="fr" ${lang() === 'fr' ? 'selected' : ''}>Français</option>
              </select>
            </label>
            <span class="spacer"></span>
            <button class="btn btn-ghost" data-logout>${esc(t('prof.logout'))}</button>
          </div>
        </section>

        <section class="card">
          <h2>${esc(t('prof.business'))}</h2>
          <form class="form" data-biz>
            <div class="field half"><label>${esc(t('prof.businessName'))}</label><input name="business_name" value="${esc(s.business_name)}"></div>
            <div class="field half"><label>${esc(t('f.email'))}</label><input name="email" type="email" value="${esc(s.email)}"></div>
            <div class="field half"><label>${esc(t('f.phone'))}</label><input name="phone" value="${esc(s.phone)}"></div>
            <div class="field"><label>${esc(t('prof.address'))}</label><textarea name="address" rows="2">${esc(s.address)}</textarea></div>

            <h3>${esc(t('prof.taxes'))}</h3>
            <label class="check"><input type="checkbox" name="taxes_on" ${s.taxes_on ? 'checked' : ''}> ${esc(t('prof.taxesOn'))}</label>
            <div class="tax-fields" ${s.taxes_on ? '' : 'hidden'}>
              <div class="field half"><label>${esc(t('prof.gstNumber'))}</label><input name="gst_number" value="${esc(s.gst_number)}"></div>
              <div class="field half"><label>${esc(t('prof.qstNumber'))}</label><input name="qst_number" value="${esc(s.qst_number)}"></div>
              <div class="field half"><label>${esc(t('prof.gstRate'))}</label><input name="gst_rate" type="number" step="0.001" value="${esc(s.gst_rate)}"></div>
              <div class="field half"><label>${esc(t('prof.qstRate'))}</label><input name="qst_rate" type="number" step="0.001" value="${esc(s.qst_rate)}"></div>
            </div>
            <div class="form-actions"><span class="spacer"></span><button class="btn btn-gold" type="submit">${esc(t('btn.save'))}</button></div>
          </form>
        </section>

        <section class="card">
          <h2>Google Calendar</h2>
          <p class="${cal && !cal.ok ? 'text-danger' : 'muted'}">${esc(calText)}</p>
          <button class="btn btn-ghost" data-cal>${esc(t('prof.calConnect'))}</button>
        </section>

        <section class="card">
          <h2>${esc(t('prof.backup'))}</h2>
          <p class="muted">${esc(t('prof.backupText'))}</p>
          <button class="btn btn-gold" data-export>${esc(t('prof.export'))}</button>
        </section>
        <p class="muted small">${VERSION}</p>
      </div>`;

    const form = view.querySelector('[data-biz]');
    form.elements.taxes_on.onchange = e => { form.querySelector('.tax-fields').hidden = !e.target.checked; };
    form.onsubmit = async e => {
      e.preventDefault();
      const f = form.elements;
      try {
        await saveSettings({
          business_name: f.business_name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(),
          address: f.address.value.trim(), taxes_on: f.taxes_on.checked,
          gst_number: f.gst_number.value.trim(), qst_number: f.qst_number.value.trim(),
          gst_rate: Number(f.gst_rate.value) || 0, qst_rate: Number(f.qst_rate.value) || 0,
        });
        toast(t('saved'));
      } catch (err) { toastError(err); }
    };

    view.querySelector('[data-lang]').onchange = async e => {
      setLang(e.target.value);
      document.querySelectorAll('#nav a span').forEach(sp => {
        sp.textContent = t('nav.' + sp.parentElement.dataset.id);
      });
      saveSettings({ language: lang() }).catch(() => {});
      ctx.rerender();
    };
    view.querySelector('[data-logout]').onclick = logout;
    view.querySelector('[data-cal]').onclick = () => loginWithGoogle();
    view.querySelector('[data-export]').onclick = async e => {
      e.target.disabled = true;
      try {
        const data = await exportAll();
        downloadFile(`moss-backup-${isoDate()}.json`, JSON.stringify(data, null, 2));
      } catch (err) { toastError(err); }
      finally { e.target.disabled = false; }
    };
  },
};
