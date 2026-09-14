// ============================================================
// Chat Service — Persistent Dexie.js Multi-Conversation Architecture
// ============================================================
// STRICT PRIVACY:
// 1. ALL chat conversations and messages live SOLELY on the user's
//    device in IndexedDB (Dexie.js). The server NEVER stores chats.
// 2. When asking Gemini, the frontend extracts the minimum necessary
//    financial context + recent conversation turns (last 10) on the fly.
// 3. Gemini acts as a transient processing engine and persists nothing.
// ============================================================

import { api } from './apiClient.js';
import { getDB } from './db.js';
import { getDailySummary, getPeriodSummary, getRecentTransactions } from './transactionStore.js';
import { calculateHealthScore } from './healthScore.js';
import { getState } from '../store.js';
import { executeFinancialTool } from './financialTools.js';

// ─── IndexedDB Conversation Helpers ───────────────────────────

export async function getConversations() {
  const db = getDB();
  try {
    const list = await db.chatConversations
      .filter((c) => !c.archived)
      .reverse()
      .sortBy('updatedAt');
    return list || [];
  } catch (err) {
    console.error('Failed to load conversations from IndexedDB', err);
    return [];
  }
}

export async function getConversation(id) {
  const db = getDB();
  try {
    return (await db.chatConversations.get(id)) || null;
  } catch (_) {
    return null;
  }
}

export async function createConversation(title = 'New Conversation') {
  const db = getDB();
  const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();
  const conv = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    archived: 0,
  };
  await db.chatConversations.put(conv);
  return conv;
}

export async function updateConversationTitle(id, title) {
  const db = getDB();
  const now = new Date().toISOString();
  await db.chatConversations.update(id, { title, updatedAt: now });
}

export async function deleteConversation(id) {
  const db = getDB();
  await db.transaction('rw', db.chatConversations, db.chatMessages, async () => {
    await db.chatConversations.delete(id);
    await db.chatMessages.where('conversationId').equals(id).delete();
  });
}

export async function getMessages(conversationId) {
  const db = getDB();
  try {
    const msgs = await db.chatMessages
      .where('conversationId')
      .equals(conversationId)
      .sortBy('createdAt');
    return msgs || [];
  } catch (err) {
    console.error('Failed to load messages from IndexedDB', err);
    return [];
  }
}

export async function saveMessage({ conversationId, role, content }) {
  const db = getDB();
  const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();
  const msg = {
    id,
    conversationId,
    role,
    content,
    createdAt: now,
  };

  await db.transaction('rw', db.chatConversations, db.chatMessages, async () => {
    await db.chatMessages.put(msg);
    await db.chatConversations.update(conversationId, { updatedAt: now });
  });

  return msg;
}

// ─── Gemini Transient AI Request ──────────────────────────────

// Regex to detect a TOOL_CALL tag emitted by Gemini:
// Matches: [TOOL_CALL: {"tool": "...", "params": {...}}]
const TOOL_CALL_REGEX = /\[TOOL_CALL:\s*(\{[\s\S]*?\})\s*\]/;

/**
 * Extract a tool call from Gemini's reply text, if present.
 * @param {string} text
 * @returns {{ toolName: string, params: object, cleanText: string } | null}
 */
function extractToolCall(text) {
  const match = text.match(TOOL_CALL_REGEX);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed.tool || typeof parsed.tool !== 'string') return null;
    return {
      toolName: parsed.tool,
      params: parsed.params || {},
      cleanText: text.replace(TOOL_CALL_REGEX, '').trim(),
    };
  } catch (_) {
    return null;
  }
}

/**
 * Format a tool result object into a readable string for Gemini.
 * All values are already in rupees at this point.
 * @param {string} toolName
 * @param {object} data
 * @returns {string}
 */
function formatToolResult(toolName, data) {
  const lines = [`[Tool Result: ${toolName}]`];

  function fmtRs(n) {
    return `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  switch (toolName) {
    case 'getTodaySummary':
      lines.push(`Date: ${data.date}`);
      lines.push(`Income: ${fmtRs(data.totalIncome)} (${data.incomeCount} transaction${data.incomeCount !== 1 ? 's' : ''})`);
      lines.push(`Expenses: ${fmtRs(data.totalExpenses)} (${data.expenseCount} transaction${data.expenseCount !== 1 ? 's' : ''})`);
      lines.push(`Net Cash Flow: ${data.netCashFlow >= 0 ? '+' : ''}${fmtRs(data.netCashFlow)}`);
      lines.push(`Total Transactions: ${data.transactionCount}`);
      if (data.categories && data.categories.length > 0) {
        lines.push('Category Breakdown:');
        data.categories.forEach((c) => lines.push(`  ${c.name}: ${fmtRs(c.amount)} (${c.percentage}%)`));
      }
      break;

    case 'getDateRangeSummary':
      lines.push(`Period: ${data.startDate} to ${data.endDate}`);
      lines.push(`Income: ${fmtRs(data.totalIncome)}`);
      lines.push(`Expenses: ${fmtRs(data.totalExpenses)}`);
      lines.push(`Net: ${data.netCashFlow >= 0 ? '+' : ''}${fmtRs(data.netCashFlow)}`);
      lines.push(`Transactions: ${data.transactionCount}`);
      lines.push(`Daily Average Expense: ${fmtRs(data.avgDailyExpense)}`);
      if (data.categories && data.categories.length > 0) {
        lines.push('Category Breakdown:');
        data.categories.forEach((c) => lines.push(`  ${c.name}: ${fmtRs(c.amount)} (${c.percentage}%)`));
      }
      if (data.largestExpense) {
        lines.push(`Largest Expense: ${fmtRs(data.largestExpense.amount)} — ${data.largestExpense.description} on ${data.largestExpense.date}`);
      }
      break;

    case 'getSpendingByCategory':
      lines.push(`Period: ${data.startDate} to ${data.endDate}`);
      lines.push(`Total Expenses: ${fmtRs(data.totalExpenses)}`);
      if (data.requestedCategory) {
        lines.push(`Filtered to category: "${data.requestedCategory}"`);
      }
      if (data.categories && data.categories.length > 0) {
        lines.push('Spending by Category:');
        data.categories.forEach((c) => lines.push(`  ${c.name}: ${fmtRs(c.amount)} (${c.percentage}%)`));
      } else {
        lines.push('No expenses found for the requested category/period.');
      }
      break;

    case 'getIncome':
      lines.push(`Period: ${data.startDate} to ${data.endDate}`);
      lines.push(`Total Income: ${fmtRs(data.totalIncome)}`);
      lines.push(`Income Transactions: ${data.transactionCount}`);
      if (data.sources && data.sources.length > 0) {
        lines.push('Income Sources:');
        data.sources.forEach((s) => lines.push(`  ${s.name}: ${fmtRs(s.amount)} (${s.percentage}%)`));
      }
      if (data.largestIncome) {
        lines.push(`Largest Income: ${fmtRs(data.largestIncome.amount)} — ${data.largestIncome.description} on ${data.largestIncome.date}`);
      }
      break;

    case 'getExpenses':
      lines.push(`Period: ${data.startDate} to ${data.endDate}`);
      lines.push(`Total Expenses: ${fmtRs(data.totalExpenses)}`);
      lines.push(`Expense Transactions: ${data.transactionCount}`);
      if (data.categories && data.categories.length > 0) {
        lines.push('By Category:');
        data.categories.forEach((c) => lines.push(`  ${c.name}: ${fmtRs(c.amount)} (${c.percentage}%)`));
      }
      if (data.topExpenses && data.topExpenses.length > 0) {
        lines.push('Top Expenses:');
        data.topExpenses.forEach((e) => lines.push(`  ${e.date}: ${fmtRs(e.amount)} — ${e.description} [${e.category}]`));
      }
      break;

    case 'getTransactionCount':
      lines.push(data.startDate ? `Period: ${data.startDate} to ${data.endDate}` : 'Period: All time');
      lines.push(`Total Count: ${data.count}`);
      if (data.incomeCount !== undefined) {
        lines.push(`  Income: ${data.incomeCount}`);
        lines.push(`  Expenses: ${data.expenseCount}`);
        lines.push(`  Transfers: ${data.transferCount}`);
      }
      break;

    case 'getTransactions':
      lines.push(`Period: ${data.startDate} to ${data.endDate}`);
      lines.push(`Total matching: ${data.totalCount} (showing up to 20)`);
      if (data.filters.type !== 'all') lines.push(`Type filter: ${data.filters.type}`);
      if (data.filters.category) lines.push(`Category filter: ${data.filters.category}`);
      if (data.transactions && data.transactions.length > 0) {
        lines.push('Transactions:');
        data.transactions.forEach((t) => {
          const sign = t.type === 'income' ? '+' : '-';
          lines.push(`  ${t.date}: ${sign}${fmtRs(t.amount)} — ${t.description} [${t.category}/${t.paymentMethod}]`);
        });
      } else {
        lines.push('No transactions found for the given filters.');
      }
      break;

    // ── Gmail Tools ──────────────────────────────────────────
    case 'checkGmailConnection':
      if (data.connected) {
        lines.push(`Gmail connected: YES`);
        if (data.email) lines.push(`Account: ${data.email}`);
        if (data.connectedAt) lines.push(`Connected since: ${data.connectedAt.substring(0, 10)}`);
      } else {
        lines.push(`Gmail connected: NO`);
        lines.push(`The user has not connected Gmail to Kanakku.`);
      }
      break;

    case 'syncGmailTransactions':
      if (data.success) {
        lines.push(`Gmail sync complete.`);
        lines.push(`New transactions imported: ${data.newTransactions}`);
        lines.push(`Duplicate emails skipped: ${data.duplicatesSkipped}`);
        lines.push(`Emails processed: ${data.totalEmailsProcessed}`);
        lines.push(`Extraction method: ${data.extractionMethod}`);
        if (data.syncedAt) lines.push(`Synced at: ${data.syncedAt.substring(0, 10)}`);
      } else {
        lines.push(`Gmail sync failed: ${data.error || 'Unknown error'}`);
      }
      break;

    case 'searchGmailTransactions':
      lines.push(`Search query: "${data.query}"`);
      lines.push(`Emails found: ${data.count}`);
      if (data.messages && data.messages.length > 0) {
        lines.push('Matching emails found in Gmail:');
        data.messages.forEach((m) => {
          lines.push(`  From: ${m.from}`);
          lines.push(`  Subject: ${m.subject}`);
          lines.push(`  Date: ${m.date || m.receivedAt || ''}`);
          lines.push(`  Snippet: ${m.snippet}`);
          lines.push(`  ---`);
        });
      } else {
        lines.push('No matching emails found.');
      }
      break;

    case 'getGmailTransaction':
      lines.push(`Period: ${data.startDate} to ${data.endDate}`);
      lines.push(`Total Gmail-synced transactions: ${data.totalCount} (showing up to 20)`);
      if (data.filters.type !== 'all') lines.push(`Type filter: ${data.filters.type}`);
      if (data.filters.description) lines.push(`Description filter: ${data.filters.description}`);
      if (data.transactions && data.transactions.length > 0) {
        lines.push('Gmail-imported transactions:');
        data.transactions.forEach((t) => {
          const sign = t.type === 'income' ? '+' : '-';
          const reviewTag = t.needsReview ? ' [needs review]' : '';
          lines.push(`  ${t.date}: ${sign}${fmtRs(t.amount)} — ${t.description} [${t.category}/${t.paymentMethod}]${reviewTag}`);
        });
      } else {
        lines.push('No Gmail-imported transactions found for the given filters.');
      }
      break;

    case 'searchGmailTransactionsByDate':
      lines.push(`Status: ${data.status}`);
      lines.push(`Period: ${data.startDate} to ${data.endDate}`);
      lines.push(`Candidate emails found in Gmail: ${data.emailsFound}`);
      lines.push(`Emails fetched: ${data.emailsFetched}`);
      lines.push(`New transactions parsed: ${data.count}`);
      lines.push(`Total amount: ${fmtRs(data.totalAmount)}`);
      if (data.syncMessage) {
        lines.push(`Note: ${data.syncMessage}`);
      }
      if (data.existingLocalCount > 0) {
        lines.push(`Existing local transactions in date range: ${data.existingLocalCount}`);
      }
      if (data.transactions && data.transactions.length > 0) {
        lines.push('Parsed Transactions:');
        data.transactions.forEach((t) => {
          const sign = t.type === 'income' ? '+' : '-';
          lines.push(`  ${t.date}: ${sign}${fmtRs(t.amount)} — ${t.description} [${t.category}/${t.paymentMethod}]`);
        });
      }
      break;

    default:
      lines.push(JSON.stringify(data, null, 2));
  }

  lines.push('[End Tool Result]');
  return lines.join('\n');
}

/**
 * @param {string} text          — user's message
 * @param {'en'|'ta'} lang
 * @param {string} [conversationId]
 * @param {function} [onStatusUpdate] — callback for status indicator updates
 * @returns {Promise<{text: string, action: object|null}>}
 */
export async function sendMessage(text, lang = 'en', conversationId = null, onStatusUpdate = null) {
  const today = new Date().toISOString().substring(0, 10);
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().substring(0, 10);

  const [daily, period, score, recent] = await Promise.all([
    getDailySummary(today),
    getPeriodSummary(monthStartStr, today, 'This month'),
    calculateHealthScore(today),
    getRecentTransactions(5),
  ]);

  const user = getState('user') || {};

  const financialContext = {
    today: {
      totalIncome: daily.totalIncome,
      totalExpenses: daily.totalExpenses,
      netCashFlow: daily.netCashFlow,
      transactionCount: daily.transactionCount,
      topCategories: daily.topCategories,
      paymentMethods: daily.paymentMethods,
    },
    period: {
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      totalIncome: period.totalIncome,
      totalExpenses: period.totalExpenses,
      netCashFlow: period.netCashFlow,
      transactionCount: period.transactionCount,
      avgDailyExpense: period.avgDailyExpense,
      topCategories: period.topCategories,
      largestExpense: period.largestExpense,
      largestIncome: period.largestIncome,
    },
    healthScore: score.score != null ? {
      score: score.score,
      factors: score.factors.map((f) => ({ label: f.label, status: f.status, detail: f.detail })),
    } : undefined,
    recentTransactions: recent.map((t) => ({
      date: t.date.substring(0, 10),
      description: t.merchant || t.description || '',
      amount: t.amount,
      type: t.type,
      category: t.category,
      paymentMethod: t.paymentMethod,
    })),
    userProfile: user.name ? { name: user.name, workType: user.workType || '' } : undefined,
  };

  // Pull only recent 10 messages from active Dexie conversation for transient context
  let history = [];
  if (conversationId) {
    const prior = await getMessages(conversationId);
    history = prior.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  const body = {
    message: text,
    financialContext,
    history,
    language: lang,
  };

  // ── Phase 1: First Gemini call ─────────────────────────────
  let res = await api.post('/ai/chat', body);

  // ── Tool-Call Dispatch Loop (max 2 rounds) ─────────────────
  // If Gemini's reply contains a [TOOL_CALL: {...}] tag, execute
  // the requested tool locally (deterministic JS), then send the
  // results back to Gemini for the final natural-language answer.
  // We cap at 2 rounds to prevent infinite loops.
  //
  // CONTEXT FIX: We include the AI's own [TOOL_CALL] emission as
  // an assistant turn in the follow-up history so Gemini understands
  // it already requested a tool and is now receiving the result.
  // Without this, Gemini may re-emit the same tool call instead of
  // composing the final natural-language answer.
  let rounds = 0;
  const MAX_ROUNDS = 3; // Increased: checkGmailConnection → Gmail tool → final answer

  // Accumulate extended history as we do tool rounds
  let extendedHistory = [...history];

  while (rounds < MAX_ROUNDS) {
    const toolCall = extractToolCall(res.reply || '');
    if (!toolCall) break; // No tool call in reply — we have the final answer

    console.info(`[ChatService] Tool call detected: ${toolCall.toolName}`, toolCall.params);

    if (toolCall.toolName === 'searchGmailTransactionsByDate') {
      const s = toolCall.params?.startDate || '';
      const e = toolCall.params?.endDate || '';
      const rangeLabel = s && e && s === e ? s : `${s} – ${e}`;
      onStatusUpdate?.(`Searching Gmail: ${rangeLabel}...`);
    } else if (toolCall.toolName === 'syncGmailTransactions') {
      onStatusUpdate?.('Syncing Gmail transactions...');
    }

    // Append the user's message and the AI's [TOOL_CALL] response to history
    // so Gemini sees the full exchange on the follow-up turn.
    extendedHistory = [
      ...extendedHistory,
      { role: 'user', content: text },
      { role: 'assistant', content: res.reply }, // includes the [TOOL_CALL] tag
    ];

    // Execute the tool deterministically on the client
    const toolResult = await executeFinancialTool(toolCall.toolName, toolCall.params);

    if (toolCall.toolName === 'searchGmailTransactionsByDate' && toolResult.success && toolResult.data) {
      const d = toolResult.data;
      if (d.status === 'SUCCESS') {
        onStatusUpdate?.(`✓ Gmail search complete: ${d.count} transaction${d.count !== 1 ? 's' : ''} found`);
      } else if (d.status === 'NO_MATCHES') {
        onStatusUpdate?.('✓ No financial emails found in Gmail');
      } else if (d.status === 'QUOTA_EXCEEDED') {
        onStatusUpdate?.('⚠️ Gmail rate limit reached');
      }
    }

    // Gmail not connected — break loop and signal the UI
    if (toolResult.gmailConnectRequired) {
      console.info('[ChatService] Gmail not connected — halting tool loop');
      return {
        text: null,
        action: null,
        needsGmailConnect: true,
      };
    }

    let toolResultText;
    if (toolResult.success) {
      toolResultText = formatToolResult(toolCall.toolName, toolResult.data);
    } else {
      toolResultText = `[Tool Result: ${toolCall.toolName}]\nError: ${toolResult.error}\n[End Tool Result]`;
    }

    // Phase 2: Send tool results back to Gemini for the final answer.
    // The follow-up message is the tool result, and the extended history
    // includes the prior [TOOL_CALL] turn so Gemini has complete context.
    const followUpMessage = `${toolResultText}\n\nUsing the data above, answer the user's original question naturally in ${lang === 'ta' ? 'Tamil' : 'English'}: "${text}"`;

    const followUpBody = {
      message: followUpMessage,
      financialContext,      // Keep the same lightweight context
      history: extendedHistory, // Extended history including the tool-call turn
      language: lang,
    };

    res = await api.post('/ai/chat', followUpBody);
    rounds++;
  }

  return { text: res.reply, action: res.action || null };
}
