// ============================================================
// Chat Page — ChatGPT-Style Modern UX with Kanakku Identity
// Gemini-Powered AI Financial Intelligence Assistant
// Persistent Local-First Multi-Conversation
// ============================================================

import { t, getLang } from '../i18n.js';
import { getState, setState } from '../store.js';
import { navigate } from '../router.js';
import { handleAIAction } from '../services/aiActionHandler.js';
import {
  getConversations,
  getConversation,
  createConversation,
  updateConversationTitle,
  deleteConversation,
  getMessages,
  saveMessage,
  sendMessage,
} from '../services/chatService.js';

let _activeConversationId = null;
let _cachedConversations = [];
let _cachedMessages = [];

export async function renderChat(container) {
  const user = getState('user') || {};
  const lang = getLang();

  // Load existing conversations from IndexedDB
  _cachedConversations = await getConversations();

  // If no conversation exists, create an initial one
  if (_cachedConversations.length === 0) {
    const initial = await createConversation('New Chat');
    _cachedConversations = [initial];
    _activeConversationId = initial.id;
  } else if (!_activeConversationId || !_cachedConversations.some(c => c.id === _activeConversationId)) {
    _activeConversationId = _cachedConversations[0].id;
  }

  // Load messages for active conversation from IndexedDB
  _cachedMessages = await getMessages(_activeConversationId);
  const activeConv = _cachedConversations.find(c => c.id === _activeConversationId);
  const convTitle = activeConv?.title || 'New Chat';

  // Group conversations by date: Today, Yesterday, Previous 7 days, Older
  const groups = groupConversationsByDate(_cachedConversations);

  container.innerHTML = `
    <div class="chat-shell">
      <!-- Mobile Backdrop for Sidebar Drawer -->
      <div id="chat-history-backdrop" class="chat-history-backdrop"></div>

      <!-- ================= LEFT CHAT HISTORY SIDEBAR ================= -->
      <aside id="chat-history-sidebar" class="chat-history-sidebar" aria-label="Conversation history">
        <!-- Sidebar Header: New Chat Button -->
        <div class="chat-history-header">
          <button id="btn-new-chat-sidebar" class="chat-new-btn" title="Create a new conversation">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>New chat</span>
          </button>
        </div>

        <!-- Grouped Conversation List -->
        <div class="chat-history-scroll" id="chat-history-list">
          ${renderGroupHTML('Today', groups.today)}
          ${renderGroupHTML('Yesterday', groups.yesterday)}
          ${renderGroupHTML('Previous 7 days', groups.previous7Days)}
          ${renderGroupHTML('Older', groups.older)}
        </div>

        <!-- Sidebar Footer: User Profile Badge -->
        <div class="chat-history-footer" id="chat-user-profile-footer" role="button" tabindex="0" title="Open Settings">
          <div class="avatar avatar-sm" style="background:var(--gradient-brand);border-radius:50%;overflow:hidden;flex-shrink:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:12px;">
            ${(user.photoURL || user.picture) ? `
              <img src="${escapeHtml(user.photoURL || user.picture)}" alt="${escapeHtml(user.name || 'User')}" style="width:100%;height:100%;object-fit:cover;" />
            ` : `
              <span>${user.name ? escapeHtml(user.name.charAt(0).toUpperCase()) : '?'}</span>
            `}
          </div>
          <div style="flex:1;min-width:0;">
            <div class="truncate" style="font-size:12.5px;font-weight:600;color:var(--color-text-primary);line-height:1.2;">
              ${escapeHtml(user.name || 'Account Holder')}
            </div>
            <div class="truncate" style="font-size:10.5px;color:var(--color-text-muted);margin-top:2px;">
              Personal • Local-First
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-text-muted);flex-shrink:0;">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </div>
      </aside>

      <!-- ================= RIGHT MAIN CHAT PANE ================= -->
      <main class="chat-main" role="region" aria-label="Chat conversation">
        <!-- Top Bar -->
        <div class="chat-header-bar">
          <div style="display:flex;align-items:center;gap:var(--space-2);min-width:0;flex:1;">
            <!-- Mobile Toggle Sidebar Drawer Button -->
            <button id="btn-toggle-chat-sidebar" class="btn btn-icon btn-ghost btn-sm" aria-label="Toggle chat history" style="display:none;width:32px;height:32px;padding:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>

            <!-- Active Chat Title & Status -->
            <div style="min-width:0;flex:1;">
              <div class="truncate" id="chat-active-title" style="font-size:var(--text-sm);font-weight:var(--weight-semibold);color:var(--color-text-primary);">
                ${escapeHtml(convTitle)}
              </div>
              <div class="text-xs" style="color:var(--color-flow);display:flex;align-items:center;gap:4px;font-weight:var(--weight-medium);margin-top:2px;">
                <span style="width:6px;height:6px;background:var(--color-flow);border-radius:50%;display:inline-block;"></span>
                Online & Local-First
              </div>
            </div>
          </div>

          <!-- Header Actions: New Chat & Delete Conversation -->
          <div style="display:flex;align-items:center;gap:var(--space-2);flex-shrink:0;">
            <button id="btn-new-chat-top" class="btn btn-secondary btn-sm" style="font-size:12px;padding:4px 10px;gap:6px;height:30px;" title="New Chat">
              <span>+</span> <span>New</span>
            </button>
            <button id="btn-delete-active-conv" class="btn btn-icon btn-ghost btn-sm" aria-label="Delete chat" title="Delete this conversation" style="width:30px;height:30px;">
              ${iconTrash()}
            </button>
          </div>
        </div>

        <!-- Messages Stream -->
        <div id="chat-messages" class="chat-messages">
          <div class="chat-messages-inner" id="chat-messages-inner">
            ${_cachedMessages.length === 0 ? renderEmptyChat() : _cachedMessages.map(renderMessageHTML).join('')}
          </div>
        </div>

        <!-- Chat Input Dock -->
        <div class="chat-input-wrapper">
          <div class="chat-input-capsule">
            <textarea
              id="chat-input"
              rows="1"
              style="resize:none;overflow:hidden;max-height:140px;line-height:1.5;background:none;border:none;outline:none;color:var(--color-text-primary);font-family:inherit;font-size:14px;flex:1;width:100%;padding:4px 2px;"
              placeholder="Ask Kanakku about your finances..."
              aria-label="Chat input"
            ></textarea>
            <button id="btn-mic" class="btn btn-secondary btn-icon" style="width:36px;height:36px;padding:0;border-radius:50%;flex-shrink:0;transition:all 0.2s ease;" aria-label="Voice input" title="Voice Input">
              ${iconMic()}
            </button>
            <button id="btn-send" class="btn btn-primary" style="width:36px;height:36px;padding:0;border-radius:50%;flex-shrink:0;" aria-label="Send" disabled>
              ${iconSend()}
            </button>
          </div>
          <div class="chat-disclaimer">
            Kanakku AI can make mistakes. Verify important financial decisions.
          </div>
        </div>
      </main>
    </div>
  `;

  // Apply responsive display for mobile sidebar toggle button
  const toggleBtn = container.querySelector('#btn-toggle-chat-sidebar');
  if (toggleBtn && window.innerWidth < 768) {
    toggleBtn.style.display = 'inline-flex';
  }

  setupChatHandlers(container);
  scrollToBottom(container);
}

// ─── Grouping Helper ──────────────────────────────────────────

function groupConversationsByDate(conversations) {
  const groups = {
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysAgoStart = todayStart - (7 * 86400000);

  conversations.forEach(c => {
    const time = new Date(c.updatedAt || c.createdAt || Date.now()).getTime();
    if (time >= todayStart) {
      groups.today.push(c);
    } else if (time >= yesterdayStart) {
      groups.yesterday.push(c);
    } else if (time >= sevenDaysAgoStart) {
      groups.previous7Days.push(c);
    } else {
      groups.older.push(c);
    }
  });

  return groups;
}

function renderGroupHTML(title, list) {
  if (!list || list.length === 0) return '';
  return `
    <div class="chat-group-label">${title}</div>
    ${list.map(c => `
      <div class="chat-history-item ${c.id === _activeConversationId ? 'active' : ''}" data-conv-id="${c.id}" role="button" tabindex="0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--color-text-muted);">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="chat-item-title" title="${escapeHtml(c.title || 'Conversation')}">${escapeHtml(c.title || 'Conversation')}</span>
        <button class="chat-item-delete" data-delete-id="${c.id}" title="Delete chat" aria-label="Delete chat">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>
      </div>
    `).join('')}
  `;
}

// ─── Setup Event Handlers ─────────────────────────────────────

function setupChatHandlers(container) {
  const input           = container.querySelector('#chat-input');
  const sendBtn         = container.querySelector('#btn-send');
  const micBtn          = container.querySelector('#btn-mic');
  const newChatSidebar  = container.querySelector('#btn-new-chat-sidebar');
  const newChatTop      = container.querySelector('#btn-new-chat-top');
  const deleteActiveBtn = container.querySelector('#btn-delete-active-conv');
  const sidebar         = container.querySelector('#chat-history-sidebar');
  const backdrop        = container.querySelector('#chat-history-backdrop');
  const toggleBtn       = container.querySelector('#btn-toggle-chat-sidebar');
  const profileFooter   = container.querySelector('#chat-user-profile-footer');
  const messagesBox     = container.querySelector('#chat-messages');

  // Drawer Toggle for Mobile
  const openDrawer = () => {
    sidebar?.classList.add('open');
    backdrop?.classList.add('open');
  };
  const closeDrawer = () => {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('open');
  };

  toggleBtn?.addEventListener('click', openDrawer);
  backdrop?.addEventListener('click', closeDrawer);

  // User Profile Footer -> Go to Settings
  profileFooter?.addEventListener('click', () => {
    navigate('/settings');
    import('../app.js').then(m => m.renderPage('settings'));
  });

  // Auto-resize textarea
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    sendBtn.disabled = input.value.trim().length === 0;
  });

  // Send on Enter (not shift+enter)
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) doSend(container);
    }
  });

  sendBtn?.addEventListener('click', () => doSend(container));

  // "+ New chat" handler
  const handleNewChat = async () => {
    closeDrawer();
    const newConv = await createConversation('New Chat');
    _activeConversationId = newConv.id;
    _cachedMessages = [];
    await renderChat(container);
    const refreshedInput = container.querySelector('#chat-input');
    refreshedInput?.focus();
  };

  newChatSidebar?.addEventListener('click', handleNewChat);
  newChatTop?.addEventListener('click', handleNewChat);

  // Switch Conversation (Click on item in sidebar)
  container.querySelectorAll('.chat-history-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      // Ignore if clicked on delete button
      if (e.target.closest('.chat-item-delete')) return;
      const convId = item.dataset.convId;
      if (convId && convId !== _activeConversationId) {
        _activeConversationId = convId;
        closeDrawer();
        await renderChat(container);
      } else {
        closeDrawer();
      }
    });
  });

  // Delete Conversation via item trash icon
  container.querySelectorAll('.chat-item-delete').forEach(delBtn => {
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const convId = delBtn.dataset.deleteId;
      if (!convId) return;

      if (confirm('Delete this conversation?')) {
        await deleteConversation(convId);
        if (_activeConversationId === convId) {
          _activeConversationId = null;
        }
        await renderChat(container);
        showActionToast('Conversation deleted', 'success');
      }
    });
  });

  // Delete Active Conversation via top bar
  deleteActiveBtn?.addEventListener('click', async () => {
    if (_activeConversationId && confirm('Delete this conversation?')) {
      await deleteConversation(_activeConversationId);
      _activeConversationId = null;
      await renderChat(container);
      showActionToast('Conversation deleted', 'success');
    }
  });

  // Empty State Suggestion Cards Delegation
  container.querySelectorAll('.chat-suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const msg = card.dataset.msg;
      if (msg && input) {
        input.value = msg;
        input.dispatchEvent(new Event('input'));
        sendBtn.disabled = false;
        doSend(container);
      }
    });
  });

  // Message Actions Delegation (Copy & Listen)
  messagesBox?.addEventListener('click', async (e) => {
    // Copy button
    const copyBtn = e.target.closest('.btn-copy-msg');
    if (copyBtn) {
      const rawText = copyBtn.dataset.rawText || '';
      try {
        await navigator.clipboard.writeText(rawText);
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-flow);"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span style="color:var(--color-flow);">Copied!</span>
        `;
        setTimeout(() => { copyBtn.innerHTML = originalHTML; }, 2000);
      } catch (_) {
        showActionToast('Could not copy to clipboard', 'error');
      }
      return;
    }

    // TTS Speak button
    const speakBtn = e.target.closest('.btn-speak-msg');
    if (speakBtn) {
      const rawText = speakBtn.dataset.rawText || '';
      speakText(rawText);
      return;
    }
  });

  // Web Speech API (Voice Recognition)
  setupSpeechRecognition(container, micBtn, input, sendBtn);
}

// ─── Voice Recognition Setup ──────────────────────────────────

function setupSpeechRecognition(container, micBtn, input, sendBtn) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSecureContext = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  let recognition = null;
  let isListening = false;
  let _lastTranscript = '';

  if (SpeechRecognition && !isSecureContext) {
    micBtn?.addEventListener('click', () => {
      showActionToast('Voice input requires HTTPS or localhost.', 'error');
    });
    micBtn?.setAttribute('title', 'Voice input requires HTTPS or localhost');
    return;
  }

  if (!SpeechRecognition) {
    micBtn?.addEventListener('click', () => {
      showActionToast('Voice input is not supported in this browser.', 'error');
    });
    micBtn?.setAttribute('title', 'Voice input not supported in this browser');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    _lastTranscript = '';
    micBtn.style.background = 'var(--color-danger, #ef4444)';
    micBtn.style.color = '#ffffff';
    micBtn.style.boxShadow = '0 0 14px rgba(239, 68, 68, 0.6)';
    micBtn.title = 'Listening... click to stop';
    if (input && !input.value.trim()) {
      input.placeholder = '🎙️ Listening...';
    }
  };

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }

    const displayText = finalText || interim;
    if (displayText && input) {
      _lastTranscript = displayText;
      input.value = displayText;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      sendBtn.disabled = false;
      input.placeholder = '';
    }

    if (finalText && finalText.trim()) {
      recognition.stop();
    }
  };

  recognition.onerror = (event) => {
    console.warn('[Voice] Speech recognition error:', event.error);
    resetMicState();
    if (event.error !== 'aborted') {
      showActionToast('Speech recognition error: ' + event.error, 'error');
    }
  };

  recognition.onend = () => {
    resetMicState();
    if (_lastTranscript.trim() && input) {
      input.value = _lastTranscript.trim();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      sendBtn.disabled = false;
      setTimeout(() => {
        if (input.value.trim()) doSend(container);
      }, 600);
    }
    _lastTranscript = '';
  };

  function resetMicState() {
    isListening = false;
    if (micBtn) {
      micBtn.style.background = '';
      micBtn.style.color = '';
      micBtn.style.boxShadow = '';
      micBtn.title = 'Voice Input';
    }
    if (input) {
      input.placeholder = 'Ask Kanakku about your finances...';
    }
  }

  micBtn?.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      _lastTranscript = '';
      const lang = getLang() || 'en';
      recognition.lang = lang === 'ta' ? 'ta-IN' : 'en-IN';
      try {
        recognition.start();
      } catch (err) {
        showActionToast('Could not start microphone', 'error');
      }
    }
  });
}

// ─── Sending Messages ─────────────────────────────────────────

async function doSend(container) {
  const input   = container.querySelector('#chat-input');
  const sendBtn = container.querySelector('#btn-send');
  const text    = input?.value?.trim();
  if (!text) return;

  if (!_activeConversationId) {
    const newConv = await createConversation('New Chat');
    _activeConversationId = newConv.id;
  }

  const isFirstMessage = _cachedMessages.length === 0;

  // Persist user message to IndexedDB
  const userMsg = await saveMessage({
    conversationId: _activeConversationId,
    role: 'user',
    content: text,
  });
  _cachedMessages.push(userMsg);

  // Auto-generate concise conversation title on first message
  if (isFirstMessage) {
    const cleanTitle = text.replace(/^[#\s*]+/, '').slice(0, 28).trim() || 'Finance Chat';
    await updateConversationTitle(_activeConversationId, cleanTitle);
    const titleEl = container.querySelector('#chat-active-title');
    if (titleEl) titleEl.textContent = cleanTitle;

    // Also update title in the sidebar list item
    const sidebarItem = container.querySelector(`.chat-history-item[data-conv-id="${_activeConversationId}"] .chat-item-title`);
    if (sidebarItem) sidebarItem.textContent = cleanTitle;
  }

  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  updateMessages(container);
  appendTypingIndicator(container);
  scrollToBottom(container);

  try {
    const resp = await sendMessage(
      text,
      getLang(),
      _activeConversationId,
      (status) => appendTypingIndicator(container, status)
    );
    removeTypingIndicator(container);

    // If Gemini requested Gmail connect
    if (resp.needsGmailConnect) {
      const gmailCardContent = renderGmailConnectCard();
      const cardMsg = await saveMessage({
        conversationId: _activeConversationId,
        role: 'assistant',
        content: gmailCardContent,
      });
      _cachedMessages.push(cardMsg);
      updateMessages(container);
      scrollToBottom(container);

      setTimeout(() => {
        container.querySelector('#btn-gmail-connect-chat')?.addEventListener('click', () => {
          navigate('/settings');
          import('../app.js').then(m => m.renderPage('settings'));
        });
      }, 100);
      return;
    }

    // Persist assistant message
    const assistantMsg = await saveMessage({
      conversationId: _activeConversationId,
      role: 'assistant',
      content: resp.text,
    });
    _cachedMessages.push(assistantMsg);

    updateMessages(container);
    scrollToBottom(container);

    // Handle AI action if attached
    if (resp.action && typeof resp.action === 'object') {
      const act = resp.action;
      if (act.type === 'navigate' || act.type === 'generate_report' || act.type === 'generate_statement' || act.type === 'generate_income_statement') {
        setTimeout(async () => {
          const result = await handleAIAction(act);
          if (result.success) showActionToast(result.message, 'success');
        }, 800);
      } else {
        const result = await handleAIAction(act);
        if (result.success) showActionToast(result.message, 'success');
      }
    }
  } catch (err) {
    removeTypingIndicator(container);
    const errorMsg = await saveMessage({
      conversationId: _activeConversationId,
      role: 'assistant',
      content: 'Could not process financial request. Please try again.',
    });
    _cachedMessages.push(errorMsg);
    updateMessages(container);
    scrollToBottom(container);
  }
}

function updateMessages(container) {
  const inner = container.querySelector('#chat-messages-inner');
  if (!inner) return;
  inner.innerHTML = _cachedMessages.map(renderMessageHTML).join('');

  container.querySelector('#btn-gmail-connect-chat')?.addEventListener('click', () => {
    navigate('/settings');
    import('../app.js').then(m => m.renderPage('settings'));
  });
}

function appendTypingIndicator(container, statusText = '') {
  const inner = container.querySelector('#chat-messages-inner');
  if (!inner) return;
  let el = inner.querySelector('#typing-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'typing-indicator';
    el.className = 'chat-msg-row ai';
    inner.appendChild(el);
  }
  el.innerHTML = `
    <div class="avatar avatar-sm" style="background:var(--gradient-brand);border-radius:10px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">🤖</div>
    <div class="chat-bubble-ai" style="padding:4px 0;">
      ${statusText ? `<div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px;font-weight:500;">${statusText}</div>` : ''}
      <div class="typing-indicator" style="padding:0;">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  scrollToBottom(container);
}

function removeTypingIndicator(container) {
  container.querySelector('#typing-indicator')?.remove();
}

function scrollToBottom(container) {
  const box = container.querySelector('#chat-messages');
  if (box) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

// ─── Rendering Helpers ────────────────────────────────────────

function renderEmptyChat() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-8) var(--space-4);text-align:center;">
      <div style="width:58px;height:58px;background:var(--gradient-brand);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:2rem;box-shadow:var(--shadow-brand);margin-bottom:var(--space-4);">
        🤖
      </div>
      <h2 style="font-size:var(--text-xl);font-weight:var(--weight-bold);color:var(--color-text-primary);margin-bottom:var(--space-2);">
        How can Kanakku help you today?
      </h2>
      <p style="font-size:var(--text-sm);color:var(--color-text-muted);max-width:440px;line-height:1.5;margin-bottom:var(--space-6);">
        Ask anything about your cash flow, daily spending, or financial health.
      </p>

      <!-- 4 Clean Suggestion Cards (ChatGPT-Style) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:var(--space-3);width:100%;max-width:640px;">
        <div class="console-card chat-suggestion-card" data-msg="How much did I spend today?" style="padding:var(--space-3) var(--space-4);text-align:left;cursor:pointer;border-radius:var(--radius-xl);transition:all 0.2s ease;">
          <div style="font-size:13px;font-weight:600;color:var(--color-text-primary);display:flex;align-items:center;gap:6px;">
            <span>📊</span> <span>How much did I spend today?</span>
          </div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">Calculate today's UPI & cash tally</div>
        </div>

        <div class="console-card chat-suggestion-card" data-msg="What's my biggest expense this month?" style="padding:var(--space-3) var(--space-4);text-align:left;cursor:pointer;border-radius:var(--radius-xl);transition:all 0.2s ease;">
          <div style="font-size:13px;font-weight:600;color:var(--color-text-primary);display:flex;align-items:center;gap:6px;">
            <span>🔍</span> <span>What's my biggest expense?</span>
          </div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">Analyze top spending categories</div>
        </div>

        <div class="console-card chat-suggestion-card" data-msg="Show my income vs expenses" style="padding:var(--space-3) var(--space-4);text-align:left;cursor:pointer;border-radius:var(--radius-xl);transition:all 0.2s ease;">
          <div style="font-size:13px;font-weight:600;color:var(--color-text-primary);display:flex;align-items:center;gap:6px;">
            <span>⚖️</span> <span>Show my income vs expenses</span>
          </div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">Review net monthly cash flow</div>
        </div>

        <div class="console-card chat-suggestion-card" data-msg="Generate my monthly statement" style="padding:var(--space-3) var(--space-4);text-align:left;cursor:pointer;border-radius:var(--radius-xl);transition:all 0.2s ease;">
          <div style="font-size:13px;font-weight:600;color:var(--color-text-primary);display:flex;align-items:center;gap:6px;">
            <span>📑</span> <span>Generate monthly statement</span>
          </div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">Create formal financial statement</div>
        </div>
      </div>
    </div>
  `;
}

function renderMessageHTML(msg) {
  const isUser = msg.role === 'user';
  const textContent = msg.content || msg.text || '';
  const formattedText = formatMarkdown(textContent);
  const time = msg.createdAt || msg.timestamp;

  if (isUser) {
    return `
      <div class="chat-msg-row user">
        <div class="chat-bubble-user">
          ${formattedText}
          <div style="font-size:10px;color:var(--color-text-muted);text-align:right;margin-top:4px;font-family:var(--font-mono);">
            ${formatTime(time)}
          </div>
        </div>
      </div>
    `;
  }

  // Assistant message
  return `
    <div class="chat-msg-row ai">
      <div class="avatar avatar-sm" style="background:var(--gradient-brand);border-radius:10px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">
        🤖
      </div>
      <div class="chat-bubble-ai">
        ${formattedText}
        <div class="chat-msg-actions">
          <button class="chat-action-btn btn-copy-msg" data-raw-text="${escapeHtml(cleanRawText(textContent))}" title="Copy response">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          </button>
          <button class="chat-action-btn btn-speak-msg" data-raw-text="${escapeHtml(cleanRawText(textContent))}" title="Read aloud">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
            <span>Listen</span>
          </button>
          <span style="font-size:10px;color:var(--color-text-muted);font-family:var(--font-mono);margin-left:4px;">
            ${formatTime(time)}
          </span>
        </div>
      </div>
    </div>
  `;
}

function renderGmailConnectCard() {
  return `
    <div style="background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-4);max-width:340px;">
      <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
        <span style="font-size:1.4rem;">📧</span>
        <strong style="color:var(--color-text-primary);font-size:var(--text-sm);">Gmail Not Connected</strong>
      </div>
      <p style="color:var(--color-text-secondary);font-size:var(--text-xs);margin:0 0 var(--space-3) 0;line-height:1.5;">
        To answer questions about your bank transactions, connect your Gmail account in Settings.
      </p>
      <button id="btn-gmail-connect-chat" class="btn btn-primary btn-sm" style="width:100%;font-size:var(--text-xs);">
        Connect Gmail →
      </button>
    </div>
  `;
}

function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
    .replace(/•/g, '&bullet;');
}

function cleanRawText(text) {
  if (!text) return '';
  return text
    .replace(/\[ACTION:[\s\S]*?\]/g, '')
    .replace(/\[TOOL_CALL:[\s\S]*?\]/g, '')
    .replace(/\[Tool Result:[\s\S]*?\]/g, '')
    .replace(/[*_#`]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function formatTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (s) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[s]));
}

function iconSend() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
}

function iconMic() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
}

function iconTrash() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;
}

// ─── Text to Speech (TTS) ─────────────────────────────────────

let _voicesCache = [];
function loadVoices() {
  if (!window.speechSynthesis) return;
  _voicesCache = window.speechSynthesis.getVoices();
}
if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function speakText(text) {
  if (!window.speechSynthesis) {
    showActionToast('Voice playback not supported in this browser.', 'error');
    return;
  }
  window.speechSynthesis.cancel();
  const clean = cleanRawText(text);
  if (!clean) return;

  const lang = getLang() || 'en';
  const targetLang = lang === 'ta' ? 'ta-IN' : 'en-IN';

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = targetLang;
  utterance.rate = 1.0;

  const voices = _voicesCache.length ? _voicesCache : window.speechSynthesis.getVoices();
  const match = voices.find(v => v.lang === targetLang) || voices.find(v => v.lang?.startsWith(targetLang.split('-')[0]));
  if (match) utterance.voice = match;

  utterance.onerror = () => {
    showActionToast('Could not play audio for this message.', 'error');
  };

  window.speechSynthesis.speak(utterance);
}

// ─── Toast Feedback ───────────────────────────────────────────

function showActionToast(message, type = 'success') {
  const isSuccess = type === 'success';
  const toast = document.createElement('div');

  Object.assign(toast.style, {
    position:     'fixed',
    bottom:       'calc(70px + 20px + env(safe-area-inset-bottom, 0px))',
    left:         '50%',
    transform:    'translateX(-50%) translateY(0)',
    background:   isSuccess ? 'var(--color-flow, #0e7c7b)' : 'var(--color-danger, #ef4444)',
    color:        '#fff',
    padding:      '8px 16px',
    borderRadius: '999px',
    fontSize:     '12.5px',
    fontWeight:   '600',
    fontFamily:   'var(--font-sans, system-ui)',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.18)',
    zIndex:       '99999',
    whiteSpace:   'nowrap',
    transition:   'opacity 0.25s ease, transform 0.25s ease',
    opacity:      '0',
    pointerEvents:'none',
  });

  toast.textContent = `${isSuccess ? '✓' : '⚠️'} ${message}`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}
