/* ============================================================
   AI TERMINAL — VS Code-style terminal for EfficientHypothesis
   ============================================================ */

var chatHoverMode = false;    // whether widget floats over other tabs
var chatConversations = [{ id: 1, name: 'Terminal 1', messages: [], phase: 'input', plan: null }];
var chatActiveConv = 0;       // index into chatConversations
var chatNextId = 2;
var chatWidgetDrag = null;    // drag state

// --- Render AI as full tab ---

function renderAITab() {
  var content = document.getElementById('app-content');
  content.innerHTML = '';
  var terminal = buildTerminalElement('tab');
  terminal.id = 'ai-terminal-tab';
  terminal.style.width = '100%';
  terminal.style.height = '100%';
  content.appendChild(terminal);
  focusChatInput();
}

// --- Render AI as floating widget ---

function renderAIWidget() {
  var existing = document.getElementById('ai-widget');
  if (existing) existing.remove();

  var widget = document.createElement('div');
  widget.id = 'ai-widget';
  widget.className = 'ai-widget';
  // Default: bottom center, narrow
  widget.style.width = '620px';
  widget.style.height = '320px';
  widget.style.left = 'calc(50% + 120px - 310px)'; // offset for sidebar
  widget.style.bottom = '24px';

  var terminal = buildTerminalElement('widget');
  widget.appendChild(terminal);

  // Resize handle
  var resizer = document.createElement('div');
  resizer.className = 'ai-widget-resizer';
  resizer.addEventListener('mousedown', startResize);
  widget.appendChild(resizer);

  document.body.appendChild(widget);

  // Make draggable via title bar
  var titlebar = widget.querySelector('.ai-term-titlebar');
  titlebar.addEventListener('mousedown', startDrag);

  focusChatInput();
}

function removeAIWidget() {
  var w = document.getElementById('ai-widget');
  if (w) w.remove();
}

// --- Build terminal DOM ---

function buildTerminalElement(mode) {
  var conv = chatConversations[chatActiveConv];
  var wrap = document.createElement('div');
  wrap.className = 'ai-term';

  // Title bar with tabs
  var titlebar = document.createElement('div');
  titlebar.className = 'ai-term-titlebar';

  var tabs = document.createElement('div');
  tabs.className = 'ai-term-tabs';
  for (var i = 0; i < chatConversations.length; i++) {
    var tab = document.createElement('div');
    tab.className = 'ai-term-tab' + (i === chatActiveConv ? ' active' : '');
    tab.dataset.idx = i;
    tab.innerHTML = '<span class="ai-term-tab-name">' + escapeHtml(chatConversations[i].name) + '</span>';
    if (chatConversations.length > 1) {
      tab.innerHTML += '<span class="ai-term-tab-close" data-idx="' + i + '">x</span>';
    }
    tab.addEventListener('click', function(e) {
      if (e.target.classList.contains('ai-term-tab-close')) {
        closeConversation(parseInt(e.target.dataset.idx));
      } else {
        switchConversation(parseInt(this.dataset.idx));
      }
    });
    tabs.appendChild(tab);
  }
  // + button for new conversation
  if (chatConversations.length < 10) {
    var addBtn = document.createElement('div');
    addBtn.className = 'ai-term-tab-add';
    addBtn.textContent = '+';
    addBtn.title = 'New conversation';
    addBtn.addEventListener('click', newConversation);
    tabs.appendChild(addBtn);
  }
  titlebar.appendChild(tabs);

  // Right side: audio button (placeholder) + minimize
  var controls = document.createElement('div');
  controls.className = 'ai-term-controls';
  controls.innerHTML =
    (mode === 'widget' ? '<button class="ai-term-ctrl-btn" onclick="toggleHoverMode()" title="Minimize"><span class="material-symbols-outlined" style="font-size:16px">minimize</span></button>' : '');
  titlebar.appendChild(controls);
  wrap.appendChild(titlebar);

  // Messages area
  var msgArea = document.createElement('div');
  msgArea.className = 'ai-term-messages';
  msgArea.id = 'ai-term-messages';
  renderTermMessages(msgArea, conv);
  wrap.appendChild(msgArea);

  // Action buttons (shown during confirming phase)
  var actionsBar = document.createElement('div');
  actionsBar.className = 'ai-term-actions';
  actionsBar.id = 'ai-term-actions';
  wrap.appendChild(actionsBar);

  // Input row
  var inputRow = document.createElement('div');
  inputRow.className = 'ai-term-input-row';
  inputRow.innerHTML =
    '<span class="ai-term-prompt">&gt;</span>' +
    '<input type="text" class="ai-term-input" id="ai-term-input" autocomplete="off" ' +
    'placeholder="I can help you manage your tasks, schedules, and more. Type a request or press / anytime." ' +
    'onkeydown="chatInputKeydown(event)">' +
    '<button class="ai-term-send ai-term-mic" title="Voice input (coming soon)" disabled><span class="material-symbols-outlined" style="font-size:18px">mic</span></button>' +
    '<button class="ai-term-send" onclick="sendChatMessage()" title="Send"><span class="material-symbols-outlined" style="font-size:18px">send</span></button>';
  wrap.appendChild(inputRow);

  updateTermActions(actionsBar, conv);
  return wrap;
}

// --- Render messages ---

function renderTermMessages(container, conv) {
  container.innerHTML = '';
  for (var i = 0; i < conv.messages.length; i++) {
    var msg = conv.messages[i];
    var line = document.createElement('div');
    line.className = 'ai-term-line';

    if (msg.role === 'user') {
      line.innerHTML = '<span class="ai-term-prompt">&gt;</span> <span class="ai-term-user-text">' + escapeHtml(msg.content) + '</span>';
    } else {
      line.innerHTML = formatTermOutput(msg.content);
    }
    container.appendChild(line);
  }
  // Loading indicator
  var loading = document.createElement('div');
  loading.id = 'ai-term-loading';
  loading.className = 'ai-term-loading';
  loading.style.display = 'none';
  loading.innerHTML = '<span class="ai-term-prompt">&gt;</span> <span class="ai-term-dots">...</span>';
  container.appendChild(loading);

  container.scrollTop = container.scrollHeight;
}

function formatTermOutput(text) {
  var lines = text.split('\n');
  var result = [];
  var inJson = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim().startsWith('```json')) { inJson = true; continue; }
    if (line.trim() === '```' && inJson) { inJson = false; continue; }
    if (inJson) continue;

    if (line.match(/^\+\s/)) {
      result.push('<span class="ai-term-create">' + escapeHtml(line) + '</span>');
    } else if (line.match(/^~\s/)) {
      result.push('<span class="ai-term-update">' + escapeHtml(line) + '</span>');
    } else if (line.match(/^x\s/)) {
      result.push('<span class="ai-term-delete">' + escapeHtml(line) + '</span>');
    } else if (line.match(/^\s+\.\.\s*[+~x]\s/)) {
      var cls = line.indexOf('+ ') >= 0 ? 'ai-term-create' : line.indexOf('~ ') >= 0 ? 'ai-term-update' : 'ai-term-delete';
      result.push('<span class="' + cls + '">' + escapeHtml(line) + '</span>');
    } else {
      result.push('<span class="ai-term-text">' + escapeHtml(line) + '</span>');
    }
  }
  return result.join('<br>');
}

function escapeHtml(text) {
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// --- Actions bar ---

function updateTermActions(container, conv) {
  if (!container) container = document.getElementById('ai-term-actions');
  if (!container) return;
  if (!conv) conv = chatConversations[chatActiveConv];

  if (conv.phase === 'confirming') {
    container.innerHTML =
      '<button class="ai-term-action-btn ai-term-btn-update" onclick="chatAction(\'update\')">update</button>' +
      '<button class="ai-term-action-btn ai-term-btn-talk" onclick="chatAction(\'talk\')">talk</button>' +
      '<button class="ai-term-action-btn ai-term-btn-continue" onclick="chatAction(\'continue\')">continue</button>';
    container.style.display = 'flex';
  } else if (conv.phase === 'done') {
    container.innerHTML =
      '<button class="ai-term-action-btn ai-term-btn-thumbsup" onclick="chatFeedback(true)"><span class="material-symbols-outlined" style="font-size:16px">thumb_up</span></button>' +
      '<button class="ai-term-action-btn ai-term-btn-thumbsdown" onclick="chatFeedback(false)"><span class="material-symbols-outlined" style="font-size:16px">thumb_down</span></button>';
    container.style.display = 'flex';
  } else if (conv.phase === 'executing') {
    container.innerHTML = '<span class="ai-term-text" style="padding:4px 8px">executing...</span>';
    container.style.display = 'flex';
  } else {
    container.style.display = 'none';
  }
}

// --- Send message ---

function sendChatMessage() {
  var input = document.getElementById('ai-term-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;

  var conv = chatConversations[chatActiveConv];
  input.value = '';
  conv.messages.push({ role: 'user', content: text });
  conv.phase = 'planning';
  refreshTerminal();
  showTermLoading(true);

  var processedMessages = conv.messages.map(function(msg) {
    if (msg.role === 'user') {
      return { role: msg.role, content: preprocessTimeExpressions(msg.content) };
    }
    return msg;
  });

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: processedMessages, timezone: (typeof prodUserTimezone !== 'undefined' && prodUserTimezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Chat failed'); });
      return r.json();
    })
    .then(function(data) {
      showTermLoading(false);
      var response = data.response || '';
      var jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          conv.plan = JSON.parse(jsonMatch[1]);
          conv.phase = 'confirming';
        } catch (e) {
          conv.plan = null;
          conv.phase = 'input';
        }
      } else {
        conv.phase = 'input';
      }
      conv.messages.push({ role: 'assistant', content: response });
      refreshTerminal();
    })
    .catch(function(err) {
      showTermLoading(false);
      conv.messages.push({ role: 'assistant', content: 'Error: ' + err.message });
      conv.phase = 'input';
      refreshTerminal();
    });
}

// --- Confirmation flow ---

function chatAction(action) {
  var conv = chatConversations[chatActiveConv];
  var input = document.getElementById('ai-term-input');

  if (action === 'continue') {
    // continue = thumbs up
    chatFeedbackSilent(true);
    conv.phase = 'executing';
    conv.messages.push({ role: 'user', content: '[continue]' });
    refreshTerminal();
    executeChatPlan();
  } else if (action === 'update' || action === 'talk') {
    // update/talk = thumbs down
    chatFeedbackSilent(false);
    var text = input ? input.value.trim() : '';
    if (!text) { if (input) input.focus(); return; }
    input.value = '';
    if (action === 'talk') conv.plan = null;
    conv.messages.push({ role: 'user', content: '[' + action + '] ' + text });
    conv.phase = 'planning';
    refreshTerminal();
    showTermLoading(true);

    var processedMessages = conv.messages.map(function(msg) {
      if (msg.role === 'user') return { role: msg.role, content: preprocessTimeExpressions(msg.content) };
      return msg;
    });

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: processedMessages, timezone: (typeof prodUserTimezone !== 'undefined' && prodUserTimezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        showTermLoading(false);
        var response = data.response || '';
        var jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try { conv.plan = JSON.parse(jsonMatch[1]); conv.phase = 'confirming'; }
          catch (e) { conv.phase = 'input'; }
        } else { conv.phase = 'input'; }
        conv.messages.push({ role: 'assistant', content: response });
        refreshTerminal();
      })
      .catch(function(err) {
        showTermLoading(false);
        conv.messages.push({ role: 'assistant', content: 'Error: ' + err.message });
        conv.phase = 'input';
        refreshTerminal();
      });
  }
}

function executeChatPlan() {
  var conv = chatConversations[chatActiveConv];
  if (!conv.plan) return;
  fetch('/api/chat/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: conv.plan }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        conv.messages.push({ role: 'assistant', content: 'Done. ' + data.executed + ' operation(s) completed.' });
      } else {
        var errors = (data.results || []).filter(function(r) { return !r.ok; });
        conv.messages.push({ role: 'assistant', content: 'Completed with ' + errors.length + ' error(s).' });
      }
      conv.plan = null;
      conv.phase = 'done';
      refreshTerminal();
      if (typeof fetchAllData === 'function') fetchAllData();
    })
    .catch(function(err) {
      conv.messages.push({ role: 'assistant', content: 'Execution failed: ' + err.message });
      conv.phase = 'confirming';
      refreshTerminal();
    });
}

// --- Feedback ---

function chatFeedback(positive) {
  chatFeedbackSilent(positive);
  // Visual: disable buttons
  var btns = document.querySelectorAll('.ai-term-btn-thumbsup, .ai-term-btn-thumbsdown');
  btns.forEach(function(b) { b.disabled = true; b.style.opacity = '0.4'; });
  var conv = chatConversations[chatActiveConv];
  conv.phase = 'input';
  setTimeout(function() { refreshTerminal(); }, 600);
}

function chatFeedbackSilent(positive) {
  var conv = chatConversations[chatActiveConv];
  var lastAssistant = '';
  for (var i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].role === 'assistant') { lastAssistant = conv.messages[i].content; break; }
  }
  fetch('/api/chat/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: conv.messages, response: lastAssistant, positive: positive }),
  }).catch(function() {});
}

// --- Conversation management ---

function newConversation() {
  if (chatConversations.length >= 10) return;
  chatConversations.push({ id: chatNextId++, name: 'Terminal ' + chatNextId, messages: [], phase: 'input', plan: null });
  chatActiveConv = chatConversations.length - 1;
  refreshTerminal();
}

function switchConversation(idx) {
  if (idx < 0 || idx >= chatConversations.length) return;
  chatActiveConv = idx;
  refreshTerminal();
}

function closeConversation(idx) {
  if (chatConversations.length <= 1) return;
  chatConversations.splice(idx, 1);
  if (chatActiveConv >= chatConversations.length) chatActiveConv = chatConversations.length - 1;
  refreshTerminal();
}

// --- Hover mode ---

function toggleHoverMode() {
  chatHoverMode = !chatHoverMode;
  if (chatHoverMode) {
    // If on AI tab, show homescreen behind the widget
    if (currentPage === 'ai') {
      var content = document.getElementById('app-content');
      if (content) content.innerHTML = renderHomescreenContent();
    }
    renderAIWidget();
  } else {
    removeAIWidget();
    // If on AI tab, re-render as full terminal
    if (currentPage === 'ai') {
      renderAITab();
    }
  }
  updateAISubtab();
}

function updateAISubtab() {
  var subtabs = document.querySelector('.sidebar-subtabs[data-parent="ai"]');
  if (!subtabs) return;
  subtabs.innerHTML =
    '<a class="sidebar-subtab' + (chatHoverMode ? ' active' : '') + '" onclick="toggleHoverMode()">' +
    'Hover<span class="material-symbols-outlined subtab-check">' + (chatHoverMode ? 'check_box' : 'check_box_outline_blank') + '</span></a>';
  subtabs.classList.add('expanded');
}

// --- Keyboard shortcuts ---

document.addEventListener('keydown', function(e) {
  if (e.key === '/' && !isInputFocused()) {
    e.preventDefault();
    if (chatHoverMode) {
      focusChatInput();
    } else {
      // Activate hover mode on current tab instead of navigating away
      chatHoverMode = true;
      renderAIWidget();
      updateAISubtab();
    }
  }
  if (e.key === 'Escape') {
    var input = document.getElementById('ai-term-input');
    if (input) input.blur();
    if (chatHoverMode) {
      // Close widget, stay on current page
      chatHoverMode = false;
      removeAIWidget();
      updateAISubtab();
      // If on AI tab, re-render as full terminal
      if (currentPage === 'ai') {
        renderAITab();
      }
    } else if (currentPage === 'ai') {
      navigateTo('home');
    }
  }
});

function isInputFocused() {
  var el = document.activeElement;
  if (!el) return false;
  var tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.contentEditable === 'true';
}

function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    var conv = chatConversations[chatActiveConv];
    if (conv.phase === 'confirming') {
      if (document.getElementById('ai-term-input').value.trim()) {
        chatAction('update');
      }
    } else if (conv.phase === 'input' || conv.phase === 'planning') {
      sendChatMessage();
    }
  }
}

// --- Drag & Resize ---

function startDrag(e) {
  if (e.target.closest('.ai-term-tab') || e.target.closest('.ai-term-ctrl-btn') || e.target.closest('.ai-term-tab-add')) return;
  var widget = document.getElementById('ai-widget');
  if (!widget) return;
  e.preventDefault();
  var rect = widget.getBoundingClientRect();
  chatWidgetDrag = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
  widget.style.bottom = 'auto';
  widget.style.right = 'auto';
  widget.style.left = rect.left + 'px';
  widget.style.top = rect.top + 'px';

  function onMove(ev) {
    var dx = ev.clientX - chatWidgetDrag.startX;
    var dy = ev.clientY - chatWidgetDrag.startY;
    widget.style.left = (chatWidgetDrag.origLeft + dx) + 'px';
    widget.style.top = (chatWidgetDrag.origTop + dy) + 'px';
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    chatWidgetDrag = null;
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startResize(e) {
  var widget = document.getElementById('ai-widget');
  if (!widget) return;
  e.preventDefault();
  var startW = widget.offsetWidth;
  var startH = widget.offsetHeight;
  var startX = e.clientX;
  var startY = e.clientY;

  function onMove(ev) {
    var newW = Math.max(400, startW + (ev.clientX - startX));
    var newH = Math.max(200, startH + (ev.clientY - startY));
    widget.style.width = newW + 'px';
    widget.style.height = newH + 'px';
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// --- Helpers ---

function refreshTerminal() {
  // Re-render wherever the terminal is displayed
  if (chatHoverMode) {
    var widget = document.getElementById('ai-widget');
    if (widget) {
      // Preserve position and size
      var savedStyle = {
        width: widget.style.width,
        height: widget.style.height,
        left: widget.style.left,
        top: widget.style.top,
        bottom: widget.style.bottom,
        right: widget.style.right
      };
      var oldTerm = widget.querySelector('.ai-term');
      if (oldTerm) oldTerm.remove();
      var terminal = buildTerminalElement('widget');
      widget.insertBefore(terminal, widget.querySelector('.ai-widget-resizer'));
      // Restore position and size
      widget.style.width = savedStyle.width;
      widget.style.height = savedStyle.height;
      widget.style.left = savedStyle.left;
      widget.style.top = savedStyle.top;
      widget.style.bottom = savedStyle.bottom;
      widget.style.right = savedStyle.right;
      // Re-attach drag handler
      var titlebar = widget.querySelector('.ai-term-titlebar');
      if (titlebar) titlebar.addEventListener('mousedown', startDrag);
      focusChatInput();
    }
  } else if (currentPage === 'ai') {
    renderAITab();
  }
}

function focusChatInput() {
  setTimeout(function() {
    var input = document.getElementById('ai-term-input');
    if (input) input.focus();
  }, 50);
}

function showTermLoading(show) {
  var el = document.getElementById('ai-term-loading');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function resetChat() {
  var conv = chatConversations[chatActiveConv];
  conv.messages = [];
  conv.plan = null;
  conv.phase = 'input';
  refreshTerminal();
}
