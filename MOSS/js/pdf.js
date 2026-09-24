// ============================================================
// Invoice → PDF download (jsPDF).
// Letter size, dark header band, gold accent, items table,
// totals, and tax numbers only when taxes are ON.
// ============================================================

import { t, lang } from './lang.js';
import { fmtDate, fmtMoney as uiMoney } from './ui.js';

// PDF fonts don't know the thin spaces French number formatting uses
const fmtMoney = v => uiMoney(v).replace(/[\u202F\u00A0]/g, ' ');

const GOLD = [201, 151, 58];
const INK = [30, 26, 22];
const MUTED = [110, 104, 98];

export function invoicePdf(inv, client, settings) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 50;
  let y = 0;

  // Header band
  doc.setFillColor(...INK);
  doc.rect(0, 0, W, 110, 'F');
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.text(settings.business_name || 'MOS', M, 62);
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(t('inv.invoice'), W - M, 50, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(inv.number, W - M, 70, { align: 'right' });

  // From / To
  y = 150;
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.text((lang() === 'fr' ? 'DE' : 'FROM'), M, y);
  doc.text(t('inv.billTo').toUpperCase(), W / 2, y);
  doc.setTextColor(...INK);
  doc.setFontSize(11);
  const fromLines = [settings.business_name, ...(settings.address || '').split('\n'), settings.email, settings.phone].filter(Boolean);
  const toLines = [client?.name, client?.email, client?.phone].filter(Boolean);
  fromLines.forEach((l, i) => doc.text(String(l), M, y + 18 + i * 15));
  toLines.forEach((l, i) => doc.text(String(l), W / 2, y + 18 + i * 15));
  y += 30 + Math.max(fromLines.length, toLines.length) * 15;

  // Dates
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`${t('inv.issue')}: ${fmtDate(inv.issue_date)}`, M, y);
  if (inv.due_date) doc.text(`${t('inv.due')}: ${fmtDate(inv.due_date)}`, W / 2, y);
  y += 30;

  // Items table
  const cols = { desc: M, qty: W - M - 190, price: W - M - 100, total: W - M };
  doc.setFillColor(245, 240, 232);
  doc.rect(M - 8, y - 14, W - 2 * M + 16, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(t('inv.item'), cols.desc, y);
  doc.text(t('inv.qty'), cols.qty, y, { align: 'right' });
  doc.text(t('inv.price'), cols.price, y, { align: 'right' });
  doc.text(t('inv.total'), cols.total, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 24;

  for (const it of inv.items || []) {
    const lines = doc.splitTextToSize(it.description, cols.qty - cols.desc - 40);
    if (y + lines.length * 14 > 680) { doc.addPage(); y = 60; }
    doc.text(lines, cols.desc, y);
    doc.text(String(it.qty), cols.qty, y, { align: 'right' });
    doc.text(fmtMoney(it.price), cols.price, y, { align: 'right' });
    doc.text(fmtMoney(it.qty * it.price), cols.total, y, { align: 'right' });
    y += lines.length * 14 + 8;
  }

  // Totals
  y += 6;
  doc.setDrawColor(...GOLD);
  doc.line(W / 2, y, W - M, y);
  y += 20;
  const totalLine = (label, value, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 13 : 10);
    doc.text(label, cols.price - 60, y, { align: 'right' });
    doc.text(fmtMoney(value), cols.total, y, { align: 'right' });
    y += bold ? 22 : 16;
  };
  totalLine(t('inv.subtotal'), inv.subtotal);
  if (settings.taxes_on) {
    totalLine(`${t('acc.gst')} (${settings.gst_rate}%)`, inv.gst);
    totalLine(`${t('acc.qst')} (${settings.qst_rate}%)`, inv.qst);
  }
  totalLine(t('inv.total'), inv.total, true);

  // Notes + tax numbers + thanks
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  y += 10;
  if (inv.notes) {
    const lines = doc.splitTextToSize(inv.notes, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 13 + 10;
  }
  const H = doc.internal.pageSize.getHeight();
  if (settings.taxes_on) {
    const nums = [settings.gst_number && `${t('prof.gstNumber')}: ${settings.gst_number}`,
                  settings.qst_number && `${t('prof.qstNumber')}: ${settings.qst_number}`].filter(Boolean).join('   ·   ');
    if (nums) doc.text(nums, M, H - 60);
  }
  doc.setTextColor(...GOLD);
  doc.text(t('inv.thanks'), M, H - 40);

  doc.save(`${inv.number}.pdf`);
}
