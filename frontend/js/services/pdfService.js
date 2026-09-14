// ============================================================
// PDF Service — Local-First Income Statement Generator
// ============================================================
// Uses jsPDF + jsPDF-AutoTable with Tamil Unicode font embedding.
// ALL generation happens locally on the device — no financial data
// is ever sent to the server.
//
// Disclosure: Generated documents are application-generated
// financial summaries based on recorded transactions. They are
// NOT bank statements, NOT audited financial statements, and
// NOT certified proof of income.
// ============================================================

import { getPeriodSummary } from './transactionStore.js';
import { getDB } from './db.js';
import { getState } from '../store.js';
import { getLang, t } from '../i18n.js';
import { registerTamilFont } from './tamilFont.js';
import { getCurrentCurrency } from './currency.js';

function toRupees(paise) {
  return Math.round(paise) / 100;
}

function fmt(n, abs = true) {
  return (abs ? Math.abs(n) : n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// ── Command Console Light Palette ─────────────────────────────
const BRAND_TEAL   = [ 14, 124, 123];  // #0e7c7b — "flow"
const BRAND_INDIGO = [ 67,  56, 202];  // #4338ca — "intel"
const INCOME       = [ 14, 124, 123];  // #0e7c7b
const EXPNS        = [220,  38,  38];  // #dc2626
const BG_HEADER    = [245, 246, 248];  // #f5f6f8
const BG_CARD      = [255, 255, 255];  // #ffffff
const BG_ALT       = [248, 250, 252];  // #f8fafc
const TEXT_MAIN    = [ 16,  21,  31];  // #10151f
const TEXT_MUTED   = [102, 112, 133];  // #667085
const BORDER_COLOR = [226, 232, 240];  // #e2e8f0

// Category display names
const CAT_NAMES_EN = {
  food:'Food & Dining', transport:'Transport', shopping:'Shopping',
  health:'Healthcare', bills:'Bills & Utilities', education:'Education',
  entertainment:'Entertainment', personal:'Personal Care', grocery:'Groceries',
  salary:'Salary', business:'Business', freelance:'Freelance',
  agriculture:'Agriculture', investment:'Investment Returns', gift:'Gift',
  transfer:'Transfer', atm:'ATM', income:'Income', other:'Other',
};

const CAT_NAMES_TA = {
  food:'உணவு & உணவகம்', transport:'போக்குவரத்து', shopping:'ஷாப்பிங்',
  health:'சுகாதாரம்', bills:'பில்கள் & பயன்பாடுகள்', education:'கல்வி',
  entertainment:'பொழுதுபோக்கு', personal:'தனிப்பட்ட பராமரிப்பு', grocery:'மளிகை',
  salary:'சம்பளம்', business:'வணிகம்', freelance:'சுயதொழில்',
  agriculture:'விவசாயம்', investment:'முதலீட்டு வருவாய்', gift:'பரிசு',
  transfer:'பரிமாற்றம்', atm:'ஏடிஎம்', income:'வருமானம்', other:'மற்றவை',
};

/**
 * Generate a PDF income statement for the given date range.
 * @param {string} startDate  YYYY-MM-DD
 * @param {string} endDate    YYYY-MM-DD
 * @param {string} label      Human-readable period label
 * @returns {Promise<void>}   Triggers browser download
 */
export async function generateStatement(startDate, endDate, label) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('PDF library not loaded');

  // ── Fetch data deterministically ──────────────────────────
  const period = await getPeriodSummary(startDate, endDate, label);
  const user   = getState('user');
  const userName = user?.name  || 'Account Holder';
  const userEmail= user?.email || '';
  const lang     = getLang() || 'en';
  const isTamil  = lang === 'ta';

  const totalIncome  = toRupees(period.totalIncome);
  const totalExpense = toRupees(period.totalExpenses);
  const netFlow      = toRupees(period.netCashFlow);
  const txnCount     = period.transactionCount;
  const avgDaily     = toRupees(period.avgDailyExpense);

  const generatedAt  = new Date().toLocaleString('en-IN', {
    day:'2-digit', month:'long', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  });

  // ── Create PDF ────────────────────────────────────────────
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210; // A4 width mm
  const margin = 16;
  let y = 0;

  // Register Tamil / Unicode font
  const hasTamilFont = await registerTamilFont(doc);
  const fontName = hasTamilFont ? 'NotoSansTamil' : 'helvetica';
  const activeCurrency = getCurrentCurrency();
  const currSym = activeCurrency.code === 'INR'
    ? (hasTamilFont ? '₹' : 'INR ')
    : `${activeCurrency.symbol} `;

  // ── Cover / Header ─────────────────────────────────────────
  // Light console header band
  doc.setFillColor(...BG_HEADER);
  doc.rect(0, 0, W, 50, 'F');

  // Brand top teal strip
  doc.setFillColor(...BRAND_TEAL);
  doc.rect(0, 0, W, 4, 'F');

  // App name
  doc.setFont(fontName, 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...BRAND_TEAL);
  doc.text('CashFlow', margin, 18);

  // Tagline
  doc.setFont(fontName, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(isTamil ? 'தனிநபர் நிதி மேலாண்மை — உள்ளூர் தனியுரிமை' : 'Personal Finance — Local-First Privacy', margin, 24);

  // Document type
  doc.setFont(fontName, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...TEXT_MAIN);
  doc.text(isTamil ? 'வருமானம் & செலவு அறிக்கை' : 'INCOME & EXPENSE STATEMENT', margin, 36);

  // Period label & timestamp
  doc.setFont(fontName, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(`${isTamil ? 'காலம்' : 'Period'}: ${label}`, margin, 42);
  doc.text(`${isTamil ? 'உருவாக்கப்பட்டது' : 'Generated'}: ${generatedAt}`, W - margin, 42, { align: 'right' });

  y = 56;

  // ── Account Info Card ─────────────────────────────────────
  doc.setFillColor(...BG_CARD);
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, W - margin * 2, 26, 2, 2, 'FD');

  doc.setFont(fontName, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(isTamil ? 'கணக்கு உரிமையாளர்' : 'ACCOUNT HOLDER', margin + 6, y + 7);

  doc.setFont(fontName, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_MAIN);
  doc.text(userName, margin + 6, y + 14);

  doc.setFont(fontName, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  if (userEmail) doc.text(userEmail, margin + 6, y + 20);

  doc.text(`${fmtDate(startDate)} – ${fmtDate(endDate)}`, W - margin - 6, y + 10, { align: 'right' });
  doc.text(`${isTamil ? 'பரிவர்த்தனைகள்' : 'Transactions'}: ${txnCount}`, W - margin - 6, y + 18, { align: 'right' });

  y += 32;

  // ── Summary Metric Cards ──────────────────────────────────
  const cardW = (W - margin * 2 - 8) / 3;

  const summaryCards = [
    {
      label: isTamil ? 'மொத்த வருமானம்' : 'TOTAL INCOME',
      value: `+${currSym}${fmt(totalIncome)}`,
      color: INCOME,
    },
    {
      label: isTamil ? 'மொத்த செலவு' : 'TOTAL EXPENSE',
      value: `-${currSym}${fmt(totalExpense)}`,
      color: EXPNS,
    },
    {
      label: netFlow >= 0 ? (isTamil ? 'நிகர உபரி' : 'NET SURPLUS') : (isTamil ? 'நிகர பற்றாக்குறை' : 'NET DEFICIT'),
      value: `${netFlow >= 0 ? '+' : ''}${currSym}${fmt(netFlow)}`,
      color: netFlow >= 0 ? INCOME : EXPNS,
    },
  ];

  summaryCards.forEach((card, i) => {
    const x = margin + i * (cardW + 4);
    doc.setFillColor(...BG_CARD);
    doc.setDrawColor(...BORDER_COLOR);
    doc.roundedRect(x, y, cardW, 26, 2, 2, 'FD');

    // Accent top bar
    doc.setFillColor(...card.color);
    doc.rect(x, y, cardW, 1.5, 'F');

    doc.setFont(fontName, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(card.label, x + cardW / 2, y + 9, { align: 'center' });

    doc.setFont(fontName, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + cardW / 2, y + 19, { align: 'center' });
  });

  y += 34;

  // ── Income Breakdown Table ─────────────────────────────────
  addSectionTitle(doc, margin, y, isTamil ? 'வருமான சுருக்கம்' : 'INCOME SUMMARY', fontName);
  y += 7;

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    styles: { font: fontName },
    head: [[isTamil ? 'விவரம்' : 'Description', `${isTamil ? 'தொகை' : 'Amount'} (${currSym})`]],
    body: [
      [`${isTamil ? 'பதிவு செய்யப்பட்ட மொத்த வருமானம்' : 'Total Recorded Income'} (${txnCount} ${isTamil ? 'பரிவர்த்தனைகள்' : 'transactions'})`, `${currSym}${fmt(totalIncome)}`],
      [isTamil ? 'சராசரி தினசரி வருமானம்' : 'Average Daily Income', `${currSym}${fmt(totalIncome / Math.max(daysBetween(startDate, endDate), 1))}`],
    ],
    theme: 'plain',
    headStyles: { fillColor: [238, 246, 246], textColor: BRAND_TEAL, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { textColor: TEXT_MAIN, fontSize: 8.5, fillColor: BG_CARD },
    alternateRowStyles: { fillColor: BG_ALT },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold', textColor: INCOME } },
    tableLineColor: BORDER_COLOR,
    tableLineWidth: 0.1,
  });

  y = doc.lastAutoTable.finalY + 9;

  // ── Expense Breakdown by Category Table ────────────────────
  addSectionTitle(doc, margin, y, isTamil ? 'வகை வாரியாக செலவு விவரம்' : 'EXPENSE BREAKDOWN BY CATEGORY', fontName);
  y += 7;

  const catDict = isTamil ? CAT_NAMES_TA : CAT_NAMES_EN;
  const catRows = period.topCategories.length > 0
    ? period.topCategories.map(c => [
        catDict[c.name] || c.name,
        `${currSym}${fmt(toRupees(c.amount))}`,
        `${c.percentage}%`,
      ])
    : [[isTamil ? 'செலவு பதிவுகள் இல்லை' : 'No expense records', '0.00', '—']];

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    styles: { font: fontName },
    head: [[isTamil ? 'வகை' : 'Category', `${isTamil ? 'தொகை' : 'Amount'} (${currSym})`, isTamil ? 'பங்கு' : 'Share']],
    body: catRows,
    foot: [[isTamil ? 'மொத்த செலவுகள்' : 'TOTAL EXPENSES', `${currSym}${fmt(totalExpense)}`, '100%']],
    theme: 'plain',
    headStyles: { fillColor: [254, 242, 242], textColor: EXPNS, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { textColor: TEXT_MAIN, fontSize: 8.5, fillColor: BG_CARD },
    alternateRowStyles: { fillColor: BG_ALT },
    footStyles: { fillColor: [254, 226, 226], textColor: EXPNS, fontStyle: 'bold', fontSize: 8.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    tableLineColor: BORDER_COLOR,
    tableLineWidth: 0.1,
  });

  y = doc.lastAutoTable.finalY + 9;

  // ── Payment Method Summary ────────────────────────────────
  if (period.paymentMethods?.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }
    addSectionTitle(doc, margin, y, isTamil ? 'பணம் செலுத்தும் முறை சுருக்கம்' : 'PAYMENT METHOD SUMMARY', fontName);
    y += 7;

    const methodNames = {
      upi:'UPI', card: isTamil ? 'அட்டை' : 'Card', cash: isTamil ? 'ரொக்கம்' : 'Cash',
      netBanking: isTamil ? 'நெட் பேங்கிங்' : 'Net Banking', atm:'ATM', transfer: isTamil ? 'வங்கி பரிமாற்றம்' : 'Bank Transfer',
    };

    const methodRows = period.paymentMethods.map(m => [
      methodNames[m.method] || m.method,
      `${currSym}${fmt(toRupees(m.amount))}`,
    ]);

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      styles: { font: fontName },
      head: [[isTamil ? 'முறை' : 'Payment Method', `${isTamil ? 'மொத்த தொகை' : 'Total Amount'} (${currSym})`]],
      body: methodRows,
      theme: 'plain',
      headStyles: { fillColor: [238, 242, 255], textColor: BRAND_INDIGO, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { textColor: TEXT_MAIN, fontSize: 8.5, fillColor: BG_CARD },
      alternateRowStyles: { fillColor: BG_ALT },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      tableLineColor: BORDER_COLOR,
      tableLineWidth: 0.1,
    });

    y = doc.lastAutoTable.finalY + 9;
  }

  // ── Important Disclosure Banner ───────────────────────────
  if (y > 235) { doc.addPage(); y = 20; }

  doc.setFillColor(254, 243, 199); // light amber
  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(0.2);
  doc.roundedRect(margin, y, W - margin * 2, 38, 2, 2, 'FD');

  doc.setFont(fontName, 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(180, 83, 9);
  doc.text(isTamil ? '⚠️ முக்கியமான தகவல் வெளிப்பாடு' : '⚠️ IMPORTANT DISCLOSURE', margin + 5, y + 7);

  doc.setFont(fontName, 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(120, 53, 15);

  const disclosure = isTamil
    ? [
        'இந்த ஆவணம் CashFlow பயன்பாட்டில் பதிவு செய்யப்பட்ட பரிவர்த்தனைகளின் அடிப்படையில் தானாக உருவாக்கப்பட்ட நிதி சுருக்கமாகும்.',
        'இது வங்கி கணக்கு அறிக்கை அல்ல, தணிக்கை செய்யப்பட்ட நிதிநிலை அறிக்கை அல்ல, சான்றளிக்கப்பட்ட வருமான ஆதாரம் அல்ல.',
        'பரிவர்த்தனை தரவு ஜிமெயில் வங்கி அறிவிப்புகள் மற்றும் கைமுறையாக பதிவு செய்யப்பட்ட உள்ளீடுகளிலிருந்து பெறப்படுகிறது.',
        'அதிகாரப்பூர்வ வங்கி அல்லது அரசு தேவைகளுக்கு அசல் வங்கி அறிக்கைகளை மட்டுமே பயன்படுத்தவும்.',
        `CashFlow • ${generatedAt} • தனிப்பட்ட விழிப்புணர்விற்கு மட்டுமே`,
      ]
    : [
        'This document is an application-generated financial summary based on transactions recorded in the CashFlow app.',
        'It is NOT a bank statement, NOT an audited financial statement, and NOT a certified proof of income.',
        'Transaction data originates from Gmail bank notifications (parsed locally) and manually entered cash/card records.',
        'This document should not be treated as a substitute for official bank records or professionally audited accounts.',
        `Generated by CashFlow App • ${generatedAt} • For personal financial awareness only`,
      ];

  disclosure.forEach((line, i) => {
    doc.text(line, margin + 5, y + 14 + i * 4.5);
  });

  // ── Footer ────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont(fontName, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUTED);
    doc.text('CashFlow — Personal Finance Command Console', margin, 290);
    doc.text(`${isTamil ? 'பக்கம்' : 'Page'} ${p} / ${pageCount}`, W - margin, 290, { align: 'right' });
    doc.setDrawColor(...BORDER_COLOR);
    doc.setLineWidth(0.3);
    doc.line(margin, 286, W - margin, 286);
  }

  // ── Download ──────────────────────────────────────────────
  const fileName = `CashFlow_Statement_${startDate}_to_${endDate}.pdf`;
  doc.save(fileName);

  // ── Save metadata to IndexedDB ────────────────────────────
  try {
    const db = getDB();
    const id = await db.statements.add({
      type: 'custom',
      label,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      fileName,
      totalIncome: period.totalIncome,
      totalExpenses: period.totalExpenses,
      transactionCount: txnCount,
    });
    const pdfBytes = doc.output('arraybuffer');
    await db.statementData.put({ statementId: id, data: pdfBytes }).catch(() => {});
  } catch (_) {}
}

function addSectionTitle(doc, x, y, text, fontName) {
  doc.setFillColor(...BRAND_TEAL);
  doc.rect(x, y + 1, 2.5, 4.5, 'F');
  doc.setFont(fontName, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND_TEAL);
  doc.text(text, x + 5, y + 5);
}

function daysBetween(start, end) {
  return Math.max(1, Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1);
}
