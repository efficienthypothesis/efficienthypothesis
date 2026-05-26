// === SPA Navigation ===

function sidebarNav(page) {
  if (currentPage === page) {
    navigateTo('home');
  } else {
    navigateTo(page);
  }
}

function navigateTo(page, push) {
  if (push === undefined) push = true;
  currentPage = page;
  // Clear now-line interval when leaving weekly
  if (nowLineInterval) { clearTimeout(nowLineInterval); nowLineInterval = null; }
  // Close rules popup when leaving projects
  closeProjectsRulesPopup();
  // Remove focus from sidebar link so arrow keys work immediately
  if (document.activeElement) document.activeElement.blur();
  var content = document.getElementById('app-content');
  var main = document.querySelector('main');

  // Toggle flush layout for tasks and weekly pages
  var flush = (page === 'tasks' || page === 'weekly' || page === 'monthly' || page === 'home' || page === 'ai');
  main.classList.toggle('page-flush', flush);
  document.documentElement.classList.toggle('page-flush-html', flush);

  // Render page content
  if (page === 'home') content.innerHTML = renderHomescreenContent();
  else if (page === 'projects') content.innerHTML = renderProjectsContent();
  else if (page === 'tasks') content.innerHTML = renderTasksContent();
  else if (page === 'monthly') content.innerHTML = renderMonthlyContent();
  else if (page === 'weekly') content.innerHTML = renderWeeklyContent();
  else if (page === 'dashboard') content.innerHTML = renderDashboardContent();
  else if (page === 'settings') content.innerHTML = renderSettingsContent();
  else if (page === 'ai') {
    if (chatHoverMode) { content.innerHTML = renderHomescreenContent(); }
    else { content.innerHTML = ''; renderAITab(); }
  }

  // Update URL
  if (push) history.pushState({ page: page }, '', '/' + page);

  // Update sidebar active state
  document.querySelectorAll('#sidebar-nav .sidebar-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // Update sidebar sub-tabs visibility
  document.querySelectorAll('.sidebar-subtabs').forEach(function(st) {
    st.classList.remove('expanded');
    st.innerHTML = '';
  });
  if (page === 'projects') {
    updateProjectsSubtab();
  }
  if (page === 'monthly') {
    updateMonthlySubtab();
  }
  if (page === 'weekly') {
    updateWeeklySubtab();
  }
  if (page === 'ai') {
    updateAISubtab();
  }

  // If leaving AI tab and hover is off, nothing to do
  // If hover is on, the widget persists (handled by chat.js)

  // Load data for this page
  loadPageData();
}

function defaultCalMonth() {
  var now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getWeekOfMonth(date) {
  // Which row of the monthly grid (Sun-start) this date falls in
  var y = date.getFullYear(), m = date.getMonth();
  var firstDow = new Date(y, m, 1).getDay(); // 0=Sun
  var d = date.getDate();
  return Math.floor((d - 1 + firstDow) / 7) + 1;
}

function updateWeeklySubtab() {
  var subtabs = document.querySelector('.sidebar-subtabs[data-parent="weekly"]');
  if (!subtabs) return;
  if (!weekCalStart) initWeekStart();
  // Reference date: today if within displayed week, otherwise Wednesday of displayed week
  var today = new Date();
  var todayStr = getTodayStr();
  var days = [];
  for (var i = 0; i < 7; i++) { var dd = new Date(weekCalStart); dd.setDate(dd.getDate() + i); days.push(fmtDate(dd)); }
  var refDate;
  if (days.indexOf(todayStr) >= 0) {
    refDate = today;
  } else {
    refDate = new Date(weekCalStart);
    refDate.setDate(refDate.getDate() + 3); // Wednesday
  }
  var weekNum = getWeekOfMonth(refDate);
  var label = refDate.getFullYear() + ' ' + MONTH_NAMES[refDate.getMonth()] + ' Week ' + weekNum;
  subtabs.innerHTML = '<span class="sidebar-subtab sidebar-subtab-info">' + label + '</span>';
  subtabs.classList.add('expanded');
}

function updateMonthlySubtab() {
  var subtabs = document.querySelector('.sidebar-subtabs[data-parent="monthly"]');
  if (!subtabs) return;
  var cm = prodCalendarMonth || defaultCalMonth();
  var parts = cm.split('-').map(Number);
  var label = MONTH_NAMES[parts[1] - 1] + ' ' + parts[0];
  subtabs.innerHTML = '<span class="sidebar-subtab sidebar-subtab-info">' + label + '</span>' +
    '<a class="sidebar-subtab' + (monthlyShowNotes ? ' active' : '') + '" onclick="toggleMonthlyNotesSidebar(this)">' +
    'Notes<span class="material-symbols-outlined subtab-check">' + (monthlyShowNotes ? 'check_box' : 'check_box_outline_blank') + '</span></a>' +
    '<a class="sidebar-subtab' + (monthlyShowPlanned ? ' active' : '') + '" onclick="toggleMonthlyPlannedSidebar(this)">' +
    'Show Planned<span class="material-symbols-outlined subtab-check">' + (monthlyShowPlanned ? 'check_box' : 'check_box_outline_blank') + '</span></a>';
  subtabs.classList.add('expanded');
}
function toggleMonthlyNotesSidebar(el) {
  monthlyShowNotes = !monthlyShowNotes;
  el.classList.toggle('active', monthlyShowNotes);
  var icon = el.querySelector('.subtab-check');
  if (icon) icon.textContent = monthlyShowNotes ? 'check_box' : 'check_box_outline_blank';
  savePreferences();
  renderCalendarFromCache();
}
function toggleMonthlyPlannedSidebar(el) {
  monthlyShowPlanned = !monthlyShowPlanned;
  el.classList.toggle('active', monthlyShowPlanned);
  var icon = el.querySelector('.subtab-check');
  if (icon) icon.textContent = monthlyShowPlanned ? 'check_box' : 'check_box_outline_blank';
  savePreferences();
  renderCalendarFromCache();
}

// Render current page from cached data (no fetch)
function renderCurrentPage() {
  if (currentPage === 'home') {
    applyHomescreenBackground();
  } else if (currentPage === 'projects') {
    renderProjects();
  } else if (currentPage === 'tasks') {
    const nowUtc = new Date();
    const today = getTodayStr();
    renderToday(prodAllTasks, today, nowUtc);
    renderIncomplete(prodAllTasks, today);
    renderPlanned(prodAllTasks, today, nowUtc, prodRoutines);
  } else if (currentPage === 'monthly') {
    showWeekView = false;
    prodCalendarMonth = prodCalendarMonth || defaultCalMonth();
    renderCalendarFromCache();
  } else if (currentPage === 'weekly') {
    showWeekView = true;
    prodCalendarMonth = prodCalendarMonth || defaultCalMonth();
    renderCalendarFromCache();
  } else if (currentPage === 'dashboard') {
    renderGoalsFromCache();
    // Populate week label
    if (!weekCalStart) initWeekStart();
    var dashLabel = document.getElementById('dash-week-label');
    if (dashLabel) {
      var wdays = [];
      for (var wi = 0; wi < 7; wi++) { var wd = new Date(weekCalStart); wd.setDate(wd.getDate() + wi); wdays.push(fmtDate(wd)); }
      dashLabel.textContent = wdays[0].slice(5) + ' \u2013 ' + wdays[6].slice(5);
    }
  } else if (currentPage === 'settings') {
    renderSettingsFromCache();
  }
}

// loadPageData — render from cache if available, else fetch first
function loadPageData() {
  if (dataLoaded) {
    renderCurrentPage();
  } else {
    fetchAllData().then(function() { renderCurrentPage(); });
  }
}

function renderSettingsFromCache() {
  var el = document.getElementById('tz-display');
  if (!el) return;
  var tz = prodUserTimezone || 'Not set';
  var label = tz;
  if (tz !== 'Not set') {
    try {
      var fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' });
      var parts = fmt.formatToParts(new Date());
      var tzName = parts.find(function(p) { return p.type === 'timeZoneName'; });
      if (tzName) label = tz.replace(/_/g, ' ') + ' (' + tzName.value + ')';
    } catch(e) {}
  }
  el.textContent = label;
  // Load homescreen background preview
  if (!homescreenSettings) {
    fetch('/api/homescreen/settings').then(function(r) { return r.json(); }).then(function(data) {
      homescreenSettings = data;
      renderSettingsBgPreview();
    }).catch(function() { homescreenSettings = { has_image: false }; renderSettingsBgPreview(); });
  } else {
    renderSettingsBgPreview();
  }
  loadIntegrations();
}

// === OAuth Integrations ===

function loadIntegrations() {
  var el = document.getElementById('settings-integrations-body');
  if (!el) return;
  fetch('/api/oauth/clients').then(function(r) { return r.json(); }).then(function(clients) {
    if (!Array.isArray(clients) || clients.length === 0) {
      el.innerHTML = '<p class="integration-empty">No integrations registered yet.</p>';
      return;
    }
    el.innerHTML = clients.map(function(c) {
      var shortId = c.client_id.length > 20 ? c.client_id.substring(0, 20) + '...' : c.client_id;
      var created = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';
      return '<div class="integration-card">' +
        '<div class="integration-info">' +
          '<span class="integration-name">' + escHtml(c.name) + '</span>' +
          '<span class="integration-meta">ID: ' + escHtml(shortId) + (created ? ' &middot; Created ' + created : '') + '</span>' +
        '</div>' +
        '<button class="prod-add-btn secondary" onclick="deleteIntegration(\'' + escHtml(c.client_id) + '\')">Delete</button>' +
      '</div>';
    }).join('');
  }).catch(function() {
    el.innerHTML = '<p class="integration-empty">Failed to load integrations.</p>';
  });
}

function registerNewClient() {
  var name = prompt('Integration name (e.g., "Claude MCP Server"):');
  if (!name || !name.trim()) return;
  var redirectUri = prompt('Redirect URI (e.g., http://localhost:8080/callback):');
  if (!redirectUri || !redirectUri.trim()) return;

  fetch('/api/oauth/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), redirect_uris: [redirectUri.trim()] }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.error) { alert('Error: ' + data.error); return; }
    showClientSecret(data);
    loadIntegrations();
  }).catch(function() { alert('Failed to register client.'); });
}

function showClientSecret(data) {
  var overlay = document.createElement('div');
  overlay.className = 'prod-modal-overlay open';
  overlay.innerHTML =
    '<div class="prod-modal">' +
      '<h3>Client Registered</h3>' +
      '<p style="color:#d93025;font-weight:500;font-size:0.85rem;margin-bottom:16px">Copy the client secret now. It will not be shown again.</p>' +
      '<div class="client-secret-row"><label>Client ID</label><div class="client-secret-display">' + escHtml(data.client_id) + '</div></div>' +
      '<div class="client-secret-row"><label>Client Secret</label><div class="client-secret-display">' + escHtml(data.client_secret) + '</div></div>' +
      '<div class="prod-modal-actions">' +
        '<button class="prod-add-btn primary" onclick="this.closest(\'.prod-modal-overlay\').remove()">Done</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

function deleteIntegration(clientId) {
  if (!confirm('Delete this integration? All its tokens will be revoked.')) return;
  fetch('/api/oauth/clients/' + clientId, { method: 'DELETE' })
    .then(function() { loadIntegrations(); })
    .catch(function() { alert('Failed to delete integration.'); });
}

function renderGoalsFromCache() {
  var el = document.getElementById('prod-data');
  if (!el) return;
  if (prodGoals.length === 0) { el.innerHTML = '<p class="prod-empty">No goals yet. Click New Goal to create one.</p>'; return; }
  el.innerHTML = prodGoals.map(function(g) {
    var unitLabel = g.unit ? ' (' + escHtml(g.unit) + ')' : '';
    return '<div class="goal-card" onclick="openLogModal(\'' + escHtml(g.name) + '\')">' +
      '<span class="material-symbols-outlined goal-card-icon">track_changes</span>' +
      '<span class="goal-card-name">' + escHtml(g.display_name || g.name) + unitLabel + '</span>' +
      '<button class="prod-add-btn secondary" style="height:26px;font-size:0.72rem;padding:0 10px" onclick="event.stopPropagation();openLogModal(\'' + escHtml(g.name) + '\')">' +
      '<span class="material-symbols-outlined" style="font-size:0.85rem">add</span> Log</button>' +
      '<button class="prod-add-btn secondary" style="height:26px;font-size:0.72rem;padding:0 10px" onclick="event.stopPropagation();viewGoalChart(\'' + escHtml(g.name) + '\')">' +
      '<span class="material-symbols-outlined" style="font-size:0.85rem">show_chart</span> View</button>' +
      '<button class="task-card-actions-btn" style="visibility:visible" onclick="event.stopPropagation();deleteGoal(\'' + escHtml(g.name) + '\')">' +
      '<span class="material-symbols-outlined">close</span></button></div>';
  }).join('');
}

function renderCalendarFromCache() {
  if (currentPage === 'weekly') {
    renderWeekView();
    return;
  }
  if (currentPage === 'monthly') {
    renderCalendar(null, prodCalendarData);
    return;
  }
}

// Fetch all data from API and store in cache
function fetchAllData() {
  return Promise.all([
    fetch('/api/tasks').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/drafts').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/routines').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/goals').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/tasks/calendar?month=' + (prodCalendarMonth || defaultCalMonth())).then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch('/api/folders').then(function(r) { return r.json(); }).catch(function() { return {"folders": []}; }),
    fetch('/api/notes').then(function(r) { return r.json(); }).catch(function() { return {"notes": []}; }),
    fetch('/api/actions').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/schedules').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/timelogs').then(function(r) { return r.json(); }).catch(function() { return []; }),
  ]).then(function(results) {
    prodAllTasks = Array.isArray(results[0]) ? results[0] : [];
    prodDrafts = Array.isArray(results[1]) ? results[1] : [];
    prodRoutines = Array.isArray(results[2]) ? results[2] : [];
    prodGoals = Array.isArray(results[3]) ? results[3] : [];
    prodCalendarData = (results[4] && typeof results[4] === 'object' && !Array.isArray(results[4])) ? results[4] : {};
    var foldersResp = results[5] && typeof results[5] === 'object' ? results[5] : {"folders": []};
    prodFolders = Array.isArray(foldersResp.folders) ? foldersResp.folders : [];
    var notesResp = results[6] && typeof results[6] === 'object' ? results[6] : {"notes": []};
    prodNotes = Array.isArray(notesResp.notes) ? notesResp.notes : [];
    prodActions = Array.isArray(results[7]) ? results[7] : [];
    prodSchedules = Array.isArray(results[8]) ? results[8] : [];
    prodTimelogs = Array.isArray(results[9]) ? results[9] : [];
    prodCalendarMonth = prodCalendarMonth || defaultCalMonth();
    dataLoaded = true;
  });
}

// Re-fetch all data after a mutation, then re-render current page
function refreshData() {
  return fetchAllData().then(function() { renderCurrentPage(); });
}

// Backward-compatible alias — called after every mutation
function loadProductivityData() { refreshData(); }

// popstate handler for browser back/forward
window.addEventListener('popstate', function(e) {
  var page = (e.state && e.state.page) || 'home';
  navigateTo(page, false);
});

// Arrow key navigation for weekly/monthly tabs
document.addEventListener('keydown', function(e) {
  // Don't intercept if user is typing in an input/textarea/select
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key === 'ArrowLeft') {
    if (currentPage === 'weekly') { changeWeek(-1); e.preventDefault(); }
    else if (currentPage === 'monthly') { changeCalendarMonth(-1); e.preventDefault(); }
  } else if (e.key === 'ArrowRight') {
    if (currentPage === 'weekly') { changeWeek(1); e.preventDefault(); }
    else if (currentPage === 'monthly') { changeCalendarMonth(1); e.preventDefault(); }
  } else if (e.key === 'ArrowUp') {
    if (currentPage === 'weekly') { weekScroll(-1); e.preventDefault(); }
  } else if (e.key === 'ArrowDown') {
    if (currentPage === 'weekly') { weekScroll(1); e.preventDefault(); }
  }
});

// Enter key on empty smart input triggers save
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  if (e.target.id !== 'sm-input') return;
  if (e.target.value.trim() === '') {
    e.preventDefault();
    saveSmartTask();
  }
});

// === Projects subtab ===
var _truncCtx = null;
function truncateToFit(text, maxPx, font) {
  if (!_truncCtx) { _truncCtx = document.createElement('canvas').getContext('2d'); }
  _truncCtx.font = font;
  if (_truncCtx.measureText(text).width <= maxPx) return text;
  var ellipsis = '...';
  var ellipsisW = _truncCtx.measureText(ellipsis).width;
  for (var i = text.length - 1; i > 0; i--) {
    if (_truncCtx.measureText(text.slice(0, i)).width + ellipsisW <= maxPx) return text.slice(0, i) + ellipsis;
  }
  return ellipsis;
}

function updateProjectsSubtab() {
  var subtabs = document.querySelector('.sidebar-subtabs[data-parent="projects"]');
  if (!subtabs) return;
  var html = '';

  // Current directory subtab with back arrow
  var focusLabel = userEmail || 'Projects';
  var atRoot = !projectsFocusPath;
  if (!atRoot) {
    var focusFolder = getFolderById(projectsFocusPath);
    focusLabel = focusFolder ? focusFolder.name : 'Projects';
  }
  var displayLabel = truncateToFit(focusLabel, 130, '500 0.88rem sans-serif');
  var arrowColor = atRoot ? 'color:#bdc1c6' : '';
  html += '<a class="sidebar-subtab" onclick="' + (atRoot ? '' : 'projectsNavigateUp()') + '">' +
    escHtml(displayLabel) + '<span class="material-symbols-outlined subtab-check" style="' + arrowColor + '">arrow_back</span></a>';

  // Mode toggle
  var modeLabel = projectsViewMode === 'visual' ? 'Visual Mode' : 'List Mode';
  var modeIcon = projectsViewMode === 'visual' ? 'grid_view' : 'view_list';
  html += '<a class="sidebar-subtab" onclick="toggleProjectsVisualSidebar(this)">' +
    modeLabel + '<span class="material-symbols-outlined subtab-check" style="opacity:1">' + modeIcon + '</span></a>';

  // Rules
  html += '<a class="sidebar-subtab" onclick="toggleProjectsRulesPopup()">' +
    'Rules<span class="material-symbols-outlined subtab-check" style="opacity:1">tune</span></a>';

  subtabs.innerHTML = html;
  subtabs.classList.add('expanded');
}

function toggleProjectsRulesPopup() {
  var existing = document.getElementById('projects-rules-popup');
  if (existing) { existing.remove(); return; }

  var popup = document.createElement('div');
  popup.id = 'projects-rules-popup';
  popup.className = 'projects-rules-popup';
  popup.innerHTML = buildProjectsRulesContent();

  // Position near sidebar
  popup.style.left = '180px';
  popup.style.top = '120px';

  // Dragging
  var header = null;
  popup.addEventListener('mousedown', function(e) {
    if (e.target.closest('.rules-popup-header')) {
      e.preventDefault();
      var startX = e.clientX, startY = e.clientY;
      var startLeft = popup.offsetLeft, startTop = popup.offsetTop;
      function onMove(ev) {
        popup.style.left = (startLeft + ev.clientX - startX) + 'px';
        popup.style.top = (startTop + ev.clientY - startY) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  });

  document.body.appendChild(popup);
}

function buildTimeToggle(ruleKey, period) {
  var active = projectsTimeFilter[ruleKey][period];
  var label = period.charAt(0).toUpperCase() + period.slice(1);
  return '<button class="rules-time-btn' + (active ? ' active' : '') + '"' +
    ' onclick="toggleProjectsTimeFilter(\'' + ruleKey + '\',\'' + period + '\')">' + label + '</button>';
}

function buildProjectsRulesContent() {
  var html = '<div class="rules-popup-header">' +
    '<span>Rules</span>' +
    '<button class="rules-popup-close" onclick="closeProjectsRulesPopup()"><span class="material-symbols-outlined">close</span></button>' +
    '</div><div class="rules-popup-body">';

  html += '<div class="rules-popup-rule">' +
    '<span>Completed</span>' +
    '<div class="rules-time-group">' + buildTimeToggle('completed','past') + buildTimeToggle('completed','present') + buildTimeToggle('completed','future') + '</div>' +
    '<input type="checkbox"' + (projectsShowCompleted ? ' checked' : '') + ' onchange="toggleProjectsCompletedSidebar(this)">' +
    '</div>';

  html += '<div class="rules-popup-rule">' +
    '<span>Notes</span>' +
    '<div class="rules-time-group">' + buildTimeToggle('notes','past') + buildTimeToggle('notes','present') + buildTimeToggle('notes','future') + '</div>' +
    '<input type="checkbox"' + (projectsShowNotes ? ' checked' : '') + ' onchange="toggleProjectsNotesSidebar(this)">' +
    '</div>';

  html += '<div class="rules-popup-rule">' +
    '<span>Empty Folders</span>' +
    '<div class="rules-time-group">' + buildTimeToggle('empty','past') + buildTimeToggle('empty','present') + buildTimeToggle('empty','future') + '</div>' +
    '<input type="checkbox"' + (projectsShowEmptyFolders ? ' checked' : '') + ' onchange="toggleProjectsEmptyFoldersSidebar(this)">' +
    '</div>';

  html += '</div>';
  return html;
}

function toggleProjectsTimeFilter(ruleKey, period) {
  projectsTimeFilter[ruleKey][period] = !projectsTimeFilter[ruleKey][period];
  savePreferences();
  renderProjects();
  refreshProjectsRulesPopup();
}

function closeProjectsRulesPopup() {
  var popup = document.getElementById('projects-rules-popup');
  if (popup) popup.remove();
}

function refreshProjectsRulesPopup() {
  var popup = document.getElementById('projects-rules-popup');
  if (!popup) return;
  var body = popup.querySelector('.rules-popup-body');
  if (body) {
    // Rebuild just the body content
    var tmp = document.createElement('div');
    tmp.innerHTML = buildProjectsRulesContent();
    body.innerHTML = tmp.querySelector('.rules-popup-body').innerHTML;
  }
}

function toggleProjectsVisualSidebar(el) {
  projectsViewMode = projectsViewMode === 'visual' ? 'list' : 'visual';
  if (projectsViewMode === 'visual') projectsFocusPath = null;
  savePreferences();
  renderProjects();
  updateProjectsSubtab();
}

function projectsNavigateUp() {
  if (!projectsFocusPath) return;
  var folder = getFolderById(projectsFocusPath);
  projectsFocusPath = folder ? (folder.parent_id || null) : null;
  savePreferences();
  renderProjects();
  updateProjectsSubtab();
}

function projectsZoomIn(folderId) {
  projectsFocusPath = folderId;
  savePreferences();
  renderProjects();
  updateProjectsSubtab();
}

// Called once from app.html's inline script
function initApp(initialPage, email) {
  userEmail = email || null;
  prodCalendarMonth = defaultCalMonth();
  initTimezone().then(function() {
    return Promise.all([
      fetch('/api/routines/materialize', { method: 'POST' }).catch(function() {}),
      fetch('/api/schedules/materialize', { method: 'POST' }).catch(function() {}),
      fetchAllData(),
    ]);
  }).then(function() {
    navigateTo(initialPage, false);
    history.replaceState({ page: initialPage }, '', '/' + initialPage);
  }).catch(function(err) {
    console.error('initApp error:', err);
    // Still navigate even if data loading failed
    navigateTo(initialPage, false);
    history.replaceState({ page: initialPage }, '', '/' + initialPage);
  });
}
