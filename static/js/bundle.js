const DEFAULT_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--default-color').trim() || '#000000';
let currentPage = 'tasks';

let prodUserTimezone = null;
let prodCalendarMonth = null;
let prodAllTasks = [];
let prodRoutines = [];
let prodDrafts = [];
let prodGoals = [];
let prodCalendarData = {};
let prodOpenDropdownEl = null;
let weekCalStart = null;
let showWeekView = false;
let use24HourTime = false; // default to 12hr (am/pm)
let weekIntervalHrs = 2; // hours per grid interval (0.5, 1, or 2)
let weekVisibleCells = 12; // how many interval rows visible on screen (6–48)
let weekScrollOffset = 0; // which interval row is at the top of the viewport
let dataLoaded = false;
let accountCreatedYear = null; // year of account creation (integer)
let accessibleStartDate = null; // "YYYY-01-01" of creation year
let accessibleEndDate = null; // "YYYY-12-31" of next year
let nowLineInterval = null; // interval ID for updating the current-time line
let prodFolders = []; // folder objects [{id, parent_id, name, color}]
let prodNotes = []; // note objects [{id, name, date, folder_id, created_at}]
let prodActions = []; // action objects [{action_id, name, start_datetime, end_datetime, ...}]
let prodSchedules = []; // schedule template objects [{id, name, start_time, end_time, pattern, ...}]
let prodTimelogs = []; // timelog objects [{log_id, parent_id, parent_type, start, end}]
let projectsShowCompleted = true; // toggle for showing completed items in projects
let projectsShowNotes = true; // toggle for showing notes in projects
let projectsShowEmptyFolders = true; // toggle for showing empty folders in projects
let projectsTimeFilter = {
  completed: { past: true, present: true, future: true },
  notes: { past: true, present: true, future: true },
  empty: { past: true, present: true, future: true }
};
let projectsViewMode = 'visual'; // 'list' | 'visual'
let projectsFocusPath = null; // null = root, or a folder id
let userEmail = null; // populated from session, used as root label
let monthlyShowNotes = true; // toggle for showing notes on monthly calendar
let monthlyShowPlanned = false; // toggle for showing planned (incomplete) tasks on monthly calendar

// --- Preferences persistence (localStorage) ---
function loadPreferences() {
  try {
    var saved = localStorage.getItem('eh_preferences');
    if (!saved) return;
    var prefs = JSON.parse(saved);
    if (prefs.projectsShowCompleted !== undefined) projectsShowCompleted = prefs.projectsShowCompleted;
    if (prefs.projectsShowNotes !== undefined) projectsShowNotes = prefs.projectsShowNotes;
    if (prefs.projectsShowEmptyFolders !== undefined) projectsShowEmptyFolders = prefs.projectsShowEmptyFolders;
    if (prefs.projectsViewMode !== undefined) projectsViewMode = prefs.projectsViewMode;
    if (prefs.projectsFocusPath !== undefined) projectsFocusPath = prefs.projectsFocusPath;
    if (prefs.projectsTimeFilter !== undefined) projectsTimeFilter = prefs.projectsTimeFilter;
    if (prefs.monthlyShowNotes !== undefined) monthlyShowNotes = prefs.monthlyShowNotes;
    if (prefs.monthlyShowPlanned !== undefined) monthlyShowPlanned = prefs.monthlyShowPlanned;
    if (prefs.use24HourTime !== undefined) use24HourTime = prefs.use24HourTime;
    if (prefs.weekIntervalHrs !== undefined) weekIntervalHrs = prefs.weekIntervalHrs;
    if (prefs.weekVisibleCells !== undefined) weekVisibleCells = prefs.weekVisibleCells;
  } catch(e) {}
}
function savePreferences() {
  try {
    localStorage.setItem('eh_preferences', JSON.stringify({
      projectsShowCompleted: projectsShowCompleted,
      projectsShowNotes: projectsShowNotes,
      projectsShowEmptyFolders: projectsShowEmptyFolders,
      projectsViewMode: projectsViewMode,
      projectsFocusPath: projectsFocusPath,
      projectsTimeFilter: projectsTimeFilter,
      monthlyShowNotes: monthlyShowNotes,
      monthlyShowPlanned: monthlyShowPlanned,
      use24HourTime: use24HourTime,
      weekIntervalHrs: weekIntervalHrs,
      weekVisibleCells: weekVisibleCells
    }));
  } catch(e) {}
}
loadPreferences();

// --- Timezone init (returns Promise) ---
function initTimezone() {
  return fetch('/api/user/timezone')
    .then(r => r.json())
    .then(data => {
      // Parse account creation year and compute accessible range
      if (data.created_at) {
        accountCreatedYear = parseInt(data.created_at.slice(0, 4));
      } else {
        accountCreatedYear = new Date().getFullYear();
      }
      var nextYear = new Date().getFullYear() + 1;
      accessibleStartDate = accountCreatedYear + '-01-01';
      accessibleEndDate = nextYear + '-12-31';

      if (!data.timezone) {
        const guess = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        return fetch('/api/user/timezone', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone: guess }),
        }).then(r => r.json()).then(() => {
          prodUserTimezone = guess;
        });
      } else {
        prodUserTimezone = data.timezone;
      }
    }).catch(function(err) {
      console.error('initTimezone error:', err);
      prodUserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      accountCreatedYear = new Date().getFullYear();
      accessibleStartDate = accountCreatedYear + '-01-01';
      accessibleEndDate = (new Date().getFullYear() + 1) + '-12-31';
    });
}

// --- Helpers ---
function getNowUTC() { return new Date().toISOString(); }
function getTodayStr() { return new Intl.DateTimeFormat('en-CA', { timeZone: prodUserTimezone }).format(new Date()); }
function ensureUTC(iso) {
  // Backend stores UTC but without 'Z' suffix — ensure JS Date parses as UTC
  if (!iso) return iso;
  if (!iso.endsWith('Z') && !iso.includes('+') && !iso.includes('-', 10)) return iso + 'Z';
  return iso;
}
function utcToLocalDate(iso) {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: prodUserTimezone }).format(new Date(ensureUTC(iso))); }
  catch { return iso.slice(0, 10); }
}
function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function formatTime(iso) {
  if (!iso) return '';
  try { return new Date(ensureUTC(iso)).toLocaleTimeString('en-US', { timeZone: prodUserTimezone, hour: 'numeric', minute: '2-digit' }); }
  catch { return iso.slice(11, 16); }
}
function formatTimeHM(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}
function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(ensureUTC(iso));
    const date = new Intl.DateTimeFormat('en-US', { timeZone: prodUserTimezone, month: 'short', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: prodUserTimezone, hour: 'numeric', minute: '2-digit' }).format(d);
    return date + ' ' + time;
  } catch { return iso.slice(0, 16); }
}
function toLocalDatetimeValue(iso) {
  if (!iso) return '';
  try {
    const d = new Date(ensureUTC(iso));
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: prodUserTimezone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12: false
    }).formatToParts(d);
    const get = t => (parts.find(p => p.type === t) || {}).value || '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch { return iso.slice(0, 16); }
}
function localInputToUTC(val) {
  if (!val) return null;
  const fake = new Date(val + ':00Z');
  const utcStr = fake.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = fake.toLocaleString('en-US', { timeZone: prodUserTimezone });
  const offsetMs = new Date(utcStr) - new Date(localStr);
  return new Date(fake.getTime() + offsetMs).toISOString();
}
function isTaskActive(t) { return (prodTimelogs || []).some(function(l) { return l.parent_id === t.task_id && !l.end; }); }
function getRootTasks(tasks) { return tasks.filter(t => (t.path || '/') === '/'); }
function getVisibleRoots(tasks) {
  // Root tasks + subtasks whose parent isn't in this filtered list (orphans).
  // A child's path = /ParentName/ (or /GrandParent/ParentName/ for deeper nesting).
  // A task is a "visible root" if its parent (the task whose taskPath === child.path) is absent.
  var taskPaths = new Set();
  tasks.forEach(function(t) {
    var tp = ((t.path || '/').replace(/\/$/, '') + '/' + t.name).replace(/\/+/g, '/');
    taskPaths.add(tp);
  });
  return tasks.filter(function(t) {
    var p = t.path || '/';
    if (p === '/') return true;
    // p is like "/ParentName/" — check if any task in the list produces that as its taskPath
    var normalized = p.replace(/\/$/, '') || '/';
    return !taskPaths.has(normalized);
  });
}

// Get fractional hours (e.g. 10.75 = 10:45) in user's timezone from UTC ISO string
function getLocalHourFrac(iso) {
  if (!iso) return 0;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: prodUserTimezone, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(ensureUTC(iso)));
    const h = parseInt((parts.find(p => p.type === 'hour') || {}).value || '0');
    const m = parseInt((parts.find(p => p.type === 'minute') || {}).value || '0');
    return h + m / 60;
  } catch { return 0; }
}

function formatHourLabel(h) {
  if (use24HourTime) return String(h).padStart(2, '0') + ':00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return h12 + ' ' + ampm;
}

// === SPA Page Rendering Functions ===

function renderProjectsContent() {
  return `<div class="projects-container">
    <div id="prod-projects"><p class="content-placeholder">Loading...</p></div>
    <div class="projects-whitespace-drop" id="projects-whitespace"
      ondragover="onProjectsWhitespaceDragOver(event)" ondragleave="onProjectsWhitespaceDragLeave(event)"
      ondrop="onProjectsWhitespaceDrop(event)">Drop here to unclassify</div>
  </div>`;
}

function renderTasksContent() {
  return `
    <div class="tasks-table">
      <div class="tasks-header">
        <div class="tasks-header-cell"><span class="material-symbols-outlined">today</span> Today</div>
        <div class="tasks-header-cell"><span class="material-symbols-outlined">pending_actions</span> Incomplete</div>
        <div class="tasks-header-cell"><span class="material-symbols-outlined">event_upcoming</span> Planned</div>
      </div>
      <div class="tasks-body">
        <div class="tasks-cell" id="prod-today"><p class="content-placeholder">Loading...</p></div>
        <div class="tasks-cell" id="prod-incomplete"><p class="content-placeholder">Loading...</p></div>
        <div class="tasks-cell" id="prod-planned"><p class="content-placeholder">Loading...</p></div>
      </div>
    </div>`;
}

function renderMonthlyContent() {
  return `<div id="monthly-root"></div>`;
}

function renderWeeklyContent() {
  return `<div id="weekly-root"></div>
  <div class="week-settings-dropdown" id="week-settings-dd">
    <label>Format</label>
    <div class="time-pill-toggle">
      <button class="${use24HourTime ? 'active' : ''}" onclick="setTimeFormat(true)">24</button>
      <button class="${use24HourTime ? '' : 'active'}" onclick="setTimeFormat(false)">12</button>
    </div>
    <label>Interval</label>
    <div class="time-pill-toggle">
      <button class="${weekIntervalHrs===0.5?'active':''}" onclick="setWeekInterval(0.5)">30m</button>
      <button class="${weekIntervalHrs===1?'active':''}" onclick="setWeekInterval(1)">1h</button>
      <button class="${weekIntervalHrs===2?'active':''}" onclick="setWeekInterval(2)">2h</button>
    </div>
    <label>Visible rows</label>
    <input type="number" id="wk-visible-cells-input" min="6" max="${Math.round(24/weekIntervalHrs)}" step="1"
      value="${weekVisibleCells}" onchange="setVisibleCellsFromInput(this)"
      onkeydown="if(event.key==='Enter'){this.blur();}"
      style="width:52px;padding:4px 6px;border:1px solid #dadce0;border-radius:4px;font-size:0.82rem;text-align:center;font-family:inherit;">
  </div>`;
}

function renderDashboardContent() {
  return `<div id="content-area"><div class="productivity-container">
    <div class="prod-toolbar"><h2>Dashboard</h2></div>
    <div class="prod-section"><div class="prod-section-header"><span class="material-symbols-outlined">monitoring</span> Data Collection
      <button class="prod-add-btn secondary" style="height:28px;font-size:0.75rem;padding:0 12px;margin-left:auto" onclick="openGoalModal()"><span class="material-symbols-outlined" style="font-size:0.9rem">add</span> New Goal</button>
    </div><div class="prod-section-body" id="prod-data"><p class="content-placeholder">Loading...</p></div></div>
  </div></div>`;
}

function renderSettingsContent() {
  var intervalLabel = weekIntervalHrs === 0.5 ? '30m' : weekIntervalHrs === 1 ? '1h' : '2h';
  return `<div class="settings-container"><h2>Settings</h2>
    <div class="settings-section"><div class="settings-section-header"><span class="material-symbols-outlined">schedule</span> Timezone</div>
      <div class="settings-section-body"><div class="settings-row"><span class="settings-label">Current timezone</span><span class="settings-value" id="tz-display">Loading...</span></div>
      <p class="settings-hint">Your timezone was auto-detected from your browser. Manual override coming soon.</p></div></div>
    <div class="settings-section"><div class="settings-section-header"><span class="material-symbols-outlined">view_week</span> Weekly View</div>
      <div class="settings-section-body">
        <div class="settings-row"><span class="settings-label">Time format</span><span class="settings-value"><div class="time-pill-toggle"><button class="${use24HourTime ? 'active' : ''}" onclick="setTimeFormat(true);renderSettingsPrefs()">24</button><button class="${use24HourTime ? '' : 'active'}" onclick="setTimeFormat(false);renderSettingsPrefs()">12</button></div></span></div>
        <div class="settings-row"><span class="settings-label">Interval</span><span class="settings-value"><div class="time-pill-toggle"><button class="${weekIntervalHrs===0.5?'active':''}" onclick="setWeekInterval(0.5);renderSettingsPrefs()">30m</button><button class="${weekIntervalHrs===1?'active':''}" onclick="setWeekInterval(1);renderSettingsPrefs()">1h</button><button class="${weekIntervalHrs===2?'active':''}" onclick="setWeekInterval(2);renderSettingsPrefs()">2h</button></div></span></div>
        <div class="settings-row"><span class="settings-label">Visible rows</span><span class="settings-value"><input type="number" id="settings-visible-cells" min="6" max="${Math.round(24/weekIntervalHrs)}" step="1" value="${weekVisibleCells}" onchange="setVisibleCells(parseInt(this.value));renderSettingsPrefs()" style="width:60px;padding:4px 8px;border:1px solid #dadce0;border-radius:4px;font-size:0.9rem"></span></div>
      </div></div>
    <div class="settings-section"><div class="settings-section-header"><span class="material-symbols-outlined">folder</span> Projects</div>
      <div class="settings-section-body">
        <div class="settings-row"><span class="settings-label">Show Completed</span><span class="settings-value"><label class="settings-toggle"><input type="checkbox" ${projectsShowCompleted ? 'checked' : ''} onchange="toggleProjectsCompleted(this.checked);renderSettingsPrefs()"><span class="settings-toggle-slider"></span></label></span></div>
        <div class="settings-row"><span class="settings-label">Show Notes</span><span class="settings-value"><label class="settings-toggle"><input type="checkbox" ${projectsShowNotes ? 'checked' : ''} onchange="projectsShowNotes=this.checked;savePreferences();renderProjects();renderSettingsPrefs()"><span class="settings-toggle-slider"></span></label></span></div>
        <div class="settings-row"><span class="settings-label">Show Empty Folders</span><span class="settings-value"><label class="settings-toggle"><input type="checkbox" ${projectsShowEmptyFolders ? 'checked' : ''} onchange="projectsShowEmptyFolders=this.checked;savePreferences();renderProjects();renderSettingsPrefs()"><span class="settings-toggle-slider"></span></label></span></div>
      </div></div>
    <div class="settings-section"><div class="settings-section-header"><span class="material-symbols-outlined">calendar_month</span> Monthly View</div>
      <div class="settings-section-body">
        <div class="settings-row"><span class="settings-label">Show Notes</span><span class="settings-value"><label class="settings-toggle"><input type="checkbox" ${monthlyShowNotes ? 'checked' : ''} onchange="monthlyShowNotes=this.checked;savePreferences();renderCalendarFromCache();renderSettingsPrefs()"><span class="settings-toggle-slider"></span></label></span></div>
        <div class="settings-row"><span class="settings-label">Show Planned</span><span class="settings-value"><label class="settings-toggle"><input type="checkbox" ${monthlyShowPlanned ? 'checked' : ''} onchange="monthlyShowPlanned=this.checked;savePreferences();renderCalendarFromCache();renderSettingsPrefs()"><span class="settings-toggle-slider"></span></label></span></div>
      </div></div>
    <div class="settings-section"><div class="settings-section-header"><span class="material-symbols-outlined">wallpaper</span> Homescreen Background</div>
      <div class="settings-section-body">
        <div id="settings-bg-section">
          <div id="settings-bg-current"></div>
          <div id="settings-bg-drop" onclick="settingsBgPickFile()">
            <span class="material-symbols-outlined" style="font-size:1.5rem;color:#9aa0a6">upload</span>
            <p style="margin:8px 0 0;font-size:0.85rem;color:#5f6368">Click to upload or drag and drop an image</p>
          </div>
          <input type="file" id="settings-bg-file-input" accept="image/*" style="display:none" onchange="settingsBgFileSelected(this)">
        </div>
      </div></div>
    <div class="settings-section"><div class="settings-section-header"><span class="material-symbols-outlined">hub</span> Integrations</div>
      <div class="settings-section-body">
        <div id="settings-integrations-body"><p class="settings-hint">Loading...</p></div>
        <button class="prod-add-btn primary" style="margin-top:12px" onclick="registerNewClient()"><span class="material-symbols-outlined" style="font-size:0.9rem;vertical-align:middle">add</span> Register new client</button>
      </div></div>
    <div class="settings-section"><div class="settings-section-header"><span class="material-symbols-outlined">logout</span> Account</div>
      <div class="settings-section-body"><a href="/logout" style="color:#d93025;text-decoration:none;font-weight:500;font-size:0.9rem;">Log out</a></div></div>
  </div>`;
}

function renderSettingsPrefs() {
  if (currentPage !== 'settings') return;
  var content = document.getElementById('app-content');
  if (content) {
    content.innerHTML = renderSettingsContent();
    renderSettingsFromCache();
  }
}

// === Homescreen ===

var homescreenSettings = null; // cached {has_image, scale, translateX, translateY}

function renderHomescreenContent() {
  // Kick off async load of homescreen settings + image
  if (!homescreenSettings) {
    fetch('/api/homescreen/settings').then(function(r) { return r.json(); }).then(function(data) {
      homescreenSettings = data;
      if (currentPage === 'home') applyHomescreenBackground();
    }).catch(function() { homescreenSettings = { has_image: false }; });
  } else {
    setTimeout(applyHomescreenBackground, 0);
  }
  return '<div id="homescreen-root">' +
    '<div id="homescreen-bg"></div>' +
    '<div id="homescreen-overlay">' +
      '<div id="homescreen-upload-area">' +
        '<button id="homescreen-plus-btn" onclick="homescreenPickFile()" title="Upload background photo">' +
          '<span class="material-symbols-outlined">add</span>' +
        '</button>' +
        '<p id="homescreen-hint">drag and drop a picture</p>' +
      '</div>' +
    '</div>' +
    '<input type="file" id="homescreen-file-input" accept="image/*" style="display:none" onchange="homescreenFileSelected(this)">' +
  '</div>';
}

function applyHomescreenBackground() {
  var bg = document.getElementById('homescreen-bg');
  var overlay = document.getElementById('homescreen-overlay');
  if (!bg || !overlay) return;
  if (homescreenSettings && homescreenSettings.has_image && homescreenSettings.image_url) {
    var s = homescreenSettings.scale || 1;
    var tx = homescreenSettings.translateX || 0;
    var ty = homescreenSettings.translateY || 0;
    bg.style.backgroundImage = 'url("' + homescreenSettings.image_url + '")';
    bg.style.backgroundSize = (s * 100) + '%';
    bg.style.backgroundPosition = (50 + tx) + '% ' + (50 + ty) + '%';
    bg.style.display = 'block';
    // Hide the upload UI when background exists
    overlay.style.display = 'none';
  } else {
    bg.style.display = 'none';
    overlay.style.display = 'flex';
  }
}

function homescreenPickFile() {
  document.getElementById('homescreen-file-input').click();
}

function homescreenFileSelected(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (!file.type.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB)'); return; }
  openCropUI(file);
  input.value = '';
}

// Drag and drop on homescreen
document.addEventListener('dragover', function(e) {
  if (currentPage !== 'home' && currentPage !== 'settings') return;
  var area = document.getElementById('homescreen-upload-area') || document.getElementById('settings-bg-drop');
  if (!area) return;
  e.preventDefault();
  area.classList.add('drag-active');
});
document.addEventListener('dragleave', function(e) {
  var area = document.getElementById('homescreen-upload-area') || document.getElementById('settings-bg-drop');
  if (!area) return;
  if (e.target === document || e.target === document.documentElement) {
    area.classList.remove('drag-active');
  }
});
document.addEventListener('drop', function(e) {
  if (currentPage !== 'home' && currentPage !== 'settings') return;
  var area = document.getElementById('homescreen-upload-area') || document.getElementById('settings-bg-drop');
  if (!area) return;
  e.preventDefault();
  area.classList.remove('drag-active');
  var files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files[0]) return;
  var file = files[0];
  if (!file.type.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB)'); return; }
  openCropUI(file);
});

// === Crop UI ===

var cropState = { file: null, url: null, scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0 };

function openCropUI(file) {
  cropState.file = file;
  cropState.url = URL.createObjectURL(file);
  cropState.scale = 1;
  cropState.tx = 0;
  cropState.ty = 0;

  var overlay = document.createElement('div');
  overlay.id = 'crop-overlay';
  overlay.innerHTML =
    '<div id="crop-backdrop"></div>' +
    '<div id="crop-viewport">' +
      '<img id="crop-image" src="' + cropState.url + '" draggable="false">' +
    '</div>' +
    '<div id="crop-controls">' +
      '<button class="crop-ctrl-btn" onclick="cropZoom(-0.1)" title="Zoom out"><span class="material-symbols-outlined">remove</span></button>' +
      '<span id="crop-zoom-label">100%</span>' +
      '<button class="crop-ctrl-btn" onclick="cropZoom(0.1)" title="Zoom in"><span class="material-symbols-outlined">add</span></button>' +
      '<button class="crop-ctrl-btn crop-save" onclick="cropSave()">Save</button>' +
      '<button class="crop-ctrl-btn crop-cancel" onclick="cropCancel()">Cancel</button>' +
    '</div>';
  document.body.appendChild(overlay);

  var img = document.getElementById('crop-image');
  img.addEventListener('mousedown', cropMouseDown);
  document.addEventListener('mousemove', cropMouseMove);
  document.addEventListener('mouseup', cropMouseUp);
  overlay.addEventListener('wheel', cropWheel, { passive: false });
  updateCropTransform();
}

function cropZoom(delta) {
  cropState.scale = Math.max(0.1, Math.min(5, cropState.scale + delta));
  updateCropTransform();
}

function cropWheel(e) {
  e.preventDefault();
  var delta = e.deltaY > 0 ? -0.05 : 0.05;
  cropZoom(delta);
}

function cropMouseDown(e) {
  e.preventDefault();
  cropState.dragging = true;
  cropState.startX = e.clientX;
  cropState.startY = e.clientY;
  cropState.startTx = cropState.tx;
  cropState.startTy = cropState.ty;
}

function cropMouseMove(e) {
  if (!cropState.dragging) return;
  var viewport = document.getElementById('crop-viewport');
  if (!viewport) return;
  var dx = e.clientX - cropState.startX;
  var dy = e.clientY - cropState.startY;
  // Convert pixel drag to percentage offset
  cropState.tx = cropState.startTx + (dx / viewport.offsetWidth) * 100;
  cropState.ty = cropState.startTy + (dy / viewport.offsetHeight) * 100;
  updateCropTransform();
}

function cropMouseUp() {
  cropState.dragging = false;
}

function updateCropTransform() {
  var img = document.getElementById('crop-image');
  var label = document.getElementById('crop-zoom-label');
  if (!img) return;
  img.style.transform = 'translate(' + cropState.tx + '%, ' + cropState.ty + '%) scale(' + cropState.scale + ')';
  if (label) label.textContent = Math.round(cropState.scale * 100) + '%';
}

function cropCancel() {
  closeCropUI();
}

function cropSave() {
  // Upload file then save settings
  var formData = new FormData();
  formData.append('file', cropState.file);

  var saveBtn = document.querySelector('.crop-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  fetch('/api/homescreen/upload', { method: 'POST', body: formData })
    .then(function(r) { return r.json(); })
    .then(function() {
      // Save crop settings
      return fetch('/api/homescreen/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scale: cropState.scale,
          translateX: cropState.tx,
          translateY: cropState.ty
        })
      });
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      closeCropUI();
      // Re-fetch settings to get fresh presigned URL
      return fetch('/api/homescreen/settings').then(function(r) { return r.json(); });
    })
    .then(function(data) {
      homescreenSettings = data;
      if (currentPage === 'home') applyHomescreenBackground();
      if (currentPage === 'settings') renderSettingsBgPreview();
    })
    .catch(function(err) {
      alert('Upload failed: ' + (err.message || 'Unknown error'));
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    });
}

function closeCropUI() {
  document.removeEventListener('mousemove', cropMouseMove);
  document.removeEventListener('mouseup', cropMouseUp);
  var overlay = document.getElementById('crop-overlay');
  if (overlay) overlay.remove();
  if (cropState.url) { URL.revokeObjectURL(cropState.url); cropState.url = null; }
}

// === Settings Background Helpers ===

function settingsBgPickFile() {
  document.getElementById('settings-bg-file-input').click();
}

function settingsBgFileSelected(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (!file.type.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB)'); return; }
  openCropUI(file);
  input.value = '';
}

function settingsBgRemove() {
  if (!confirm('Remove homescreen background?')) return;
  fetch('/api/homescreen/image', { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function() {
      homescreenSettings = { has_image: false };
      renderSettingsBgPreview();
    });
}

function renderSettingsBgPreview() {
  var container = document.getElementById('settings-bg-current');
  if (!container) return;
  if (homescreenSettings && homescreenSettings.has_image && homescreenSettings.image_url) {
    container.innerHTML = '<img id="settings-bg-preview" src="' + homescreenSettings.image_url + '">' +
      '<br><button class="prod-add-btn secondary" style="height:30px;font-size:0.78rem;margin-top:8px" onclick="settingsBgRemove()"><span class="material-symbols-outlined" style="font-size:0.9rem">delete</span> Remove</button>';
  } else {
    container.innerHTML = '<p style="font-size:0.85rem;color:#9aa0a6;margin:0 0 12px">No background set</p>';
  }
}

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

// --- (Data loading is now handled by fetchAllData/refreshData above) ---

// --- Task Card HTML ---
function taskCardHtml(t, opts = {}) {
  const done = !!t.end_datetime;
  const active = isTaskActive(t);
  let timeHtml = '';
  if (done) timeHtml = `<span class="task-card-time">Done ${formatTime(t.end_datetime)}</span>`;
  else if (t.due_datetime) timeHtml = `<span class="task-card-time">Due ${formatDateTime(t.due_datetime)}</span>`;
  else if (opts.showDate && t.assign_datetime) timeHtml = `<span class="task-card-time">${formatDateTime(t.assign_datetime)}</span>`;
  const activeIcon = active ? '<span class="material-symbols-outlined" style="color:#f9ab00;font-size:1rem" title="Active">star</span>' : '';
  let actionBtns = '';
  if (!done) {
    if (active) {
      actionBtns = `<button class="prod-add-btn secondary" style="height:26px;font-size:0.72rem;padding:0 10px" onclick="event.stopPropagation();pauseTask('${t.task_id}')">Pause</button>
        <button class="prod-add-btn primary" style="height:26px;font-size:0.72rem;padding:0 10px" onclick="event.stopPropagation();completeTask('${t.task_id}')">Complete</button>`;
    } else {
      actionBtns = `<button class="prod-add-btn secondary" style="height:26px;font-size:0.72rem;padding:0 10px" onclick="event.stopPropagation();startTask('${t.task_id}')">Start</button>`;
    }
  }
  const checkAction = done ? `undoComplete('${t.task_id}')` : `completeTask('${t.task_id}')`;
  const checkTitle = done ? 'Click to undo completion' : 'Mark complete';
  const menuHtml = `<div class="task-card-actions">
      <button class="task-card-actions-btn" onclick="event.stopPropagation();toggleProdDropdown(this)" title="Actions">
        <span class="material-symbols-outlined">more_vert</span>
      </button>
      <div class="task-card-dropdown" data-task-id="${t.task_id}">
        <button class="task-card-dd-item" onclick="event.stopPropagation();openEditFromCard('${t.task_id}')">
          <span class="material-symbols-outlined">edit</span> Edit
        </button>
        <button class="task-card-dd-item" onclick="event.stopPropagation();openSnoozeTask('${t.task_id}')">
          <span class="material-symbols-outlined">snooze</span> Reschedule
        </button>
        <button class="task-card-dd-item danger" onclick="event.stopPropagation();deleteTask('${t.task_id}')">
          <span class="material-symbols-outlined">delete</span> Delete
        </button>
      </div>
    </div>`;
  const taskPath = ((t.path || '/').replace(/\/$/, '') + '/' + t.name).replace(/\/+/g, '/');
  const children = (opts.allTasks || []).filter(c => c.task_id !== t.task_id && (c.path || '/') === taskPath);
  const hasChildren = children.length > 0;
  let childrenHtml = '';
  if (hasChildren) {
    childrenHtml = `<div class="task-card-children" style="width:100%">` +
      children.map(c => taskCardHtml(c, { ...opts, allTasks: opts.allTasks })).join('') + `</div>`;
  }
  return `<div class="task-card${hasChildren ? ' has-children' : ''}" draggable="true" data-task-id="${t.task_id}"
      ondragstart="onCardDragStart(event)" ondragend="onCardDragEnd(event)"
      ondragover="onCardDragOver(event)" ondragleave="onCardDragLeave(event)" ondrop="onCardDrop(event)">
    ${activeIcon}
    <div class="task-card-check${done ? ' done' : ''}" onclick="event.stopPropagation();${checkAction}" title="${checkTitle}"></div>
    <span class="task-card-name${done ? ' done' : ''}">${escHtml(t.name)}</span>
    ${timeHtml} ${actionBtns} ${menuHtml} ${childrenHtml}
  </div>`;
}

// --- Section renderers ---
function renderToday(tasks, today, nowUtc) {
  const el = document.getElementById('prod-today'); if (!el) return;
  const todayTasks = tasks.filter(t => {
    if (t.draft) return false;
    const assignDate = utcToLocalDate(t.assign_datetime);
    const assignDt = t.assign_datetime ? new Date(t.assign_datetime) : null;
    const dueDt = t.due_datetime ? new Date(t.due_datetime) : null;
    // Show if: not yet complete, assign has passed (or is today), and due hasn't passed yet
    if (assignDt && assignDt > nowUtc) return false;
    if (t.end_datetime) return assignDate === today;
    if (dueDt && dueDt < nowUtc) return false;
    return true;
  }).sort((a, b) => (a.due_datetime || '').localeCompare(b.due_datetime || ''));
  if (todayTasks.length === 0) { el.innerHTML = '<p class="prod-empty">No tasks for today yet.</p>'; return; }
  el.innerHTML = '<div class="prod-drop-toplevel" ondragover="onTopDragOver(event)" ondragleave="onTopDragLeave(event)" ondrop="onTopDrop(event)">Drop here for top level</div>' +
    getVisibleRoots(todayTasks).sort((a,b)=>(a.due_datetime||'').localeCompare(b.due_datetime||'')).map(t => taskCardHtml(t, { allTasks: todayTasks })).join('');
}

function renderIncomplete(tasks, today) {
  const el = document.getElementById('prod-incomplete'); if (!el) return;
  const nowUtc = new Date();
  const incomplete = tasks.filter(t => {
    if (t.draft || t.end_datetime) return false;
    const due = t.due_datetime;
    if (!due) return false;
    return new Date(due) < nowUtc;
  }).sort((a, b) => (a.due_datetime || '').localeCompare(b.due_datetime || ''));
  if (incomplete.length === 0) { el.innerHTML = '<p class="prod-empty">No incomplete tasks. Nice work!</p>'; return; }
  el.innerHTML = '<div class="prod-drop-toplevel" ondragover="onTopDragOver(event)" ondragleave="onTopDragLeave(event)" ondrop="onTopDrop(event)">Drop here for top level</div>' +
    getVisibleRoots(incomplete).map(t => taskCardHtml(t, { showDate: true, allTasks: incomplete })).join('');
}

function renderPlanned(tasks, today, nowUtc, routines) {
  const el = document.getElementById('prod-planned'); if (!el) return;
  const planned = tasks.filter(t => {
    if (t.draft || t.end_datetime) return false;
    const assignDate = utcToLocalDate(t.assign_datetime);
    const assignDt = t.assign_datetime ? new Date(t.assign_datetime) : null;
    return (assignDate > today) || (assignDt && assignDt > nowUtc && assignDate === today);
  }).sort((a, b) => (a.assign_datetime || '').localeCompare(b.assign_datetime || ''));
  let html = '';
  if (planned.length > 0) {
    html += '<div class="prod-block-label">Upcoming Tasks</div>';
    html += planned.map(t => taskCardHtml(t, { showDate: true })).join('');
  }
  if (routines.length > 0) {
    html += '<div class="prod-block-label" style="margin-top:16px">Routine Templates</div>';
    routines.forEach(r => {
      const patternLabel = patternToDisplay(r.pattern || 'interval:1');
      const assignLabel = r.assign_time ? ` · ${formatTimeHM(r.assign_time)}` : '';
      const dueLabel = r.due_time ? ` - ${formatTimeHM(r.due_time)}` : '';
      const instancesLabel = r.max_instances ? ` · ${r.instances || 0}/${r.max_instances}` : '';
      const inactiveLabel = !r.active ? ' · <em>inactive</em>' : '';
      html += `<div class="task-card${!r.active ? ' done' : ''}">
        <span class="material-symbols-outlined" style="color:#9aa0a6;font-size:1rem">repeat</span>
        <span class="task-card-name">${escHtml(r.name)}</span>
        <span class="task-card-badge afternoon">${patternLabel}${assignLabel}${dueLabel}${instancesLabel}${inactiveLabel}</span>
        <div class="task-card-actions">
          <button class="task-card-actions-btn" onclick="event.stopPropagation();toggleProdDropdown(this)">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
          <div class="task-card-dropdown">
            <button class="task-card-dd-item" onclick="event.stopPropagation();editRoutine('${r.id}')">
              <span class="material-symbols-outlined">edit</span> Edit
            </button>
            <button class="task-card-dd-item danger" onclick="event.stopPropagation();deleteRoutine('${r.id}')">
              <span class="material-symbols-outlined">delete</span> Delete
            </button>
          </div>
        </div>
      </div>`;
    });
  }
  el.innerHTML = html || '<p class="prod-empty">No planned tasks or routine templates.</p>';
}

function renderDrafts(drafts) {
  const el = document.getElementById('prod-drafts'); if (!el) return;
  if (drafts.length === 0) { el.innerHTML = '<p class="prod-empty">No drafts.</p>'; return; }
  el.innerHTML = drafts.map(d => {
    var typeLabel, icon;
    if (d.draft_type === 'note') { typeLabel = 'Note'; icon = 'note'; }
    else if (d.draft_type === 'folder') { typeLabel = 'Group'; icon = 'folder'; }
    else if (d.is_routine_draft) { typeLabel = 'Routine'; icon = 'repeat'; }
    else { typeLabel = 'Task'; icon = 'draft'; }
    return `<div class="task-card" style="opacity:0.7;border-style:dashed">
    <span class="material-symbols-outlined" style="color:#9aa0a6;font-size:1rem">${icon}</span>
    <span class="task-card-name" style="cursor:pointer" onclick="resumeDraft('${d.draft_id}')">${escHtml(d.name || 'Untitled draft')}</span>
    <span class="task-card-badge afternoon">${typeLabel}</span>
    <button class="task-card-actions-btn" style="visibility:visible" onclick="event.stopPropagation();deleteDraft('${d.draft_id}')">
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>`;
  }).join('');
}

// --- Projects page ---
function toggleProjectsCompleted(checked) {
  projectsShowCompleted = checked;
  savePreferences();
  renderProjects();
}
function toggleProjectsCompletedSidebar(el) {
  projectsShowCompleted = el.checked !== undefined ? el.checked : !projectsShowCompleted;
  savePreferences();
  renderProjects();
}
function toggleProjectsNotesSidebar(el) {
  projectsShowNotes = el.checked !== undefined ? el.checked : !projectsShowNotes;
  savePreferences();
  renderProjects();
}
function toggleProjectsEmptyFoldersSidebar(el) {
  projectsShowEmptyFolders = el.checked !== undefined ? el.checked : !projectsShowEmptyFolders;
  savePreferences();
  renderProjects();
}

// --- Task actions ---
function startTask(id) { fetch('/api/tasks/'+id+'/start',{method:'POST'}).then(r=>{if(!r.ok)throw 0;return r.json()}).then(()=>loadProductivityData()).catch(()=>alert('Failed.')); }
function pauseTask(id) { fetch('/api/tasks/'+id+'/pause',{method:'POST'}).then(r=>{if(!r.ok)throw 0;return r.json()}).then(()=>loadProductivityData()).catch(()=>alert('Failed.')); }

function completeTask(taskId) {
  const task = prodAllTasks.find(t => t.task_id === taskId);
  if (task) {
    const taskPath = ((task.path || '/').replace(/\/$/, '') + '/' + task.name).replace(/\/+/g, '/');
    const incompleteChildren = prodAllTasks.filter(c =>
      c.task_id !== taskId && ((c.path || '/') === taskPath || (c.path || '/').startsWith(taskPath + '/')) && !c.end_datetime
    );
    if (incompleteChildren.length > 0) {
      if (!confirm(`${incompleteChildren.length} subtask(s) are incomplete. Mark all as complete?`)) return;
      const promises = incompleteChildren.map(c => fetch('/api/tasks/'+c.task_id+'/complete',{method:'POST'}));
      promises.push(fetch('/api/tasks/'+taskId+'/complete',{method:'POST'}));
      Promise.all(promises).then(()=>{showUndoToast(taskId,incompleteChildren.map(c=>c.task_id));loadProductivityData();}).catch(()=>alert('Failed.'));
      return;
    }
  }
  fetch('/api/tasks/'+taskId+'/complete',{method:'POST'}).then(r=>{if(!r.ok)throw 0;return r.json()}).then(()=>{showUndoToast(taskId);loadProductivityData();}).catch(()=>alert('Failed.'));
}

function undoComplete(taskId) {
  fetch('/api/tasks/'+taskId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({end_datetime:null,due_status:'pending'})})
    .then(r=>{if(!r.ok)throw 0;return r.json()}).then(()=>loadProductivityData()).catch(()=>alert('Failed.'));
}

let undoToastTimer = null;
function showUndoToast(taskId, childIds = []) {
  document.querySelectorAll('.undo-toast').forEach(t => t.remove());
  if (undoToastTimer) clearTimeout(undoToastTimer);
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  const count = 1 + childIds.length;
  toast.innerHTML = `Task${count > 1 ? 's' : ''} completed <button onclick="undoCompleteAll(['${taskId}'${childIds.map(c=>`,'${c}'`).join('')}]); this.parentElement.remove();">Undo</button>`;
  document.body.appendChild(toast);
  undoToastTimer = setTimeout(() => toast.remove(), 6000);
}

function undoCompleteAll(taskIds) {
  Promise.all(taskIds.map(id => fetch('/api/tasks/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({end_datetime:null,due_status:'pending'})}))).then(()=>loadProductivityData());
}

function deleteTask(taskId) {
  closeProdDropdowns();
  if (!confirm('Delete this task?')) return;
  fetch('/api/tasks/'+taskId,{method:'DELETE'}).then(r=>{if(!r.ok)throw 0;return r.json()}).then(()=>loadProductivityData()).catch(()=>alert('Failed.'));
}

function deleteRoutine(templateId) {
  closeProdDropdowns();
  if (!confirm('Delete this routine?')) return;
  fetch('/api/routines/'+templateId,{method:'DELETE'}).then(r=>{if(!r.ok)throw 0;return r.json()}).then(()=>loadProductivityData()).catch(()=>alert('Failed.'));
}

function editRoutine(templateId) {
  closeProdDropdowns();
  fetch('/api/routines').then(r=>r.json()).then(templates => {
    const t = templates.find(x => x.id === templateId); if (!t) return;
    openSmartModal(true);
    document.getElementById('sm-editing-id').value = templateId;
    document.getElementById('sm-name').value = t.name || '';
    document.getElementById('sm-assign-time').value = t.assign_time || '07:00';
    if (t.due_time) { document.getElementById('sm-due').value = t.due_time; }
    if (t.first_day) { document.getElementById('sm-first-day').value = t.first_day; }
    // Set pattern using new format
    var pattern = t.pattern || 'interval:1';
    setPatternInModal(pattern);
    document.getElementById('sm-max-instances').value = t.max_instances || 85;
    document.getElementById('sm-max-instances').disabled = false;
  });
}

function toggleProdDropdown(btn) { closeProdDropdowns(); const dd = btn.nextElementSibling; if (dd) { dd.classList.add('open'); prodOpenDropdownEl = dd; } }
function closeProdDropdowns() { if (prodOpenDropdownEl) { prodOpenDropdownEl.classList.remove('open'); prodOpenDropdownEl = null; } }
document.addEventListener('click', function(e) {
  closeProdDropdowns();
  // Close week settings dropdown if click is outside it and the button
  var dd = document.getElementById('week-settings-dd');
  if (dd && dd.classList.contains('open') && !e.target.closest('.week-settings-btn') && !e.target.closest('.week-settings-dropdown')) {
    dd.classList.remove('open');
    var btn = document.getElementById('week-settings-btn');
    if (btn) { var icon = btn.querySelector('.material-symbols-outlined'); if (icon) icon.textContent = 'add'; }
  }
});

// --- Drag and Drop ---
let draggedTaskId = null;
function onCardDragStart(e) { const c=e.target.closest('.task-card');if(!c)return;draggedTaskId=c.dataset.taskId;c.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedTaskId);document.querySelectorAll('.prod-drop-toplevel').forEach(z=>z.classList.add('drag-active')); }
function onCardDragEnd(e) { const c=e.target.closest('.task-card');if(c)c.classList.remove('dragging');draggedTaskId=null;document.querySelectorAll('.task-card.drag-over').forEach(c=>c.classList.remove('drag-over'));document.querySelectorAll('.prod-drop-toplevel').forEach(z=>{z.classList.remove('drag-active','drag-over');}); }
function onCardDragOver(e) { e.preventDefault();const c=e.target.closest('.task-card');if(c&&c.dataset.taskId!==draggedTaskId)c.classList.add('drag-over'); }
function onCardDragLeave(e) { const c=e.target.closest('.task-card');if(c)c.classList.remove('drag-over'); }
function onCardDrop(e) { e.preventDefault();const tc=e.target.closest('.task-card');if(!tc||!draggedTaskId)return;tc.classList.remove('drag-over');const tid=tc.dataset.taskId;if(tid===draggedTaskId)return;const target=prodAllTasks.find(t=>t.task_id===tid);if(!target)return;const newPath=((target.path||'/').replace(/\/$/,'')+'/'+target.name).replace(/\/+/g,'/');moveTaskAndChildren(draggedTaskId,newPath); }
function onTopDragOver(e) { e.preventDefault();e.target.classList.add('drag-over'); }
function onTopDragLeave(e) { e.target.classList.remove('drag-over'); }
function onTopDrop(e) { e.preventDefault();e.target.classList.remove('drag-over');if(draggedTaskId)moveTaskAndChildren(draggedTaskId,'/'); }

function moveTaskAndChildren(taskId, newPath) {
  const task=prodAllTasks.find(t=>t.task_id===taskId);if(!task)return;
  const oldPath=(task.path||'/').replace(/\/$/,'')+'/'+task.name;
  const children=prodAllTasks.filter(t=>{const tp=t.path||'/';return tp===oldPath||tp.startsWith(oldPath+'/');});
  const promises=[fetch('/api/tasks/'+taskId+'/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:newPath})})];
  const newParent=newPath.replace(/\/$/,'')+'/'+task.name;
  children.forEach(c=>{const cp=c.path||'/';promises.push(fetch('/api/tasks/'+c.task_id+'/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:newParent+cp.slice(oldPath.length)})}));});
  Promise.all(promises).then(()=>loadProductivityData()).catch(()=>alert('Failed.'));
}

function getItemTemporalStatus(item) {
  var today = getTodayStr();
  if (item.type === 'task' || item.type === 'routine') {
    var assignDate = item.assign ? utcToLocalDate(item.assign) : '';
    var dueDate = item.due ? utcToLocalDate(item.due) : '';
    if (assignDate && dueDate) {
      if (today < assignDate) return 'future';
      if (today > dueDate) return 'past';
      return 'present';
    } else if (assignDate) {
      if (today < assignDate) return 'future';
      if (today > assignDate) return 'past';
      return 'present';
    } else if (dueDate) {
      if (today < dueDate) return 'future';
      if (today > dueDate) return 'past';
      return 'present';
    }
    return 'present';
  }
  if (item.type === 'note') {
    var noteDate = item.due || '';
    if (!noteDate) return 'present';
    if (noteDate === today) return 'present';
    return noteDate < today ? 'past' : 'future';
  }
  if (item.type === 'action') {
    var startDate = item.assign ? utcToLocalDate(item.assign) : '';
    var endDate = item.due ? utcToLocalDate(item.due) : '';
    if (startDate === today || endDate === today) return 'present';
    if (startDate && startDate > today) return 'future';
    if (endDate && endDate < today) return 'past';
    if (startDate && startDate < today) return 'past';
    return 'present';
  }
  return 'present';
}

function isItemVisibleByTimeFilter(item) {
  var status = getItemTemporalStatus(item);
  if (item.done) {
    var tf = projectsTimeFilter.completed;
    return tf[status];
  }
  if (item.type === 'note') {
    var tf = projectsTimeFilter.notes;
    return tf[status];
  }
  // tasks, routines, actions — no time filter rule yet, always show
  return true;
}

function getFolderById(folderId) {
  if (!folderId) return null;
  return prodFolders.find(function(g) { return g.id === folderId; }) || null;
}

function getFolderColor(folderId) {
  if (!folderId) return null;
  var folder = getFolderById(folderId);
  if (folder) return folder.color;
  return null;
}

function getFolderLabel(folder) {
  if (!folder) return '';
  var names = [];
  var current = folder;
  var guard = 0;
  while (current && guard < 20) {
    names.unshift(current.name || '');
    current = getFolderById(current.parent_id);
    guard++;
  }
  return names.filter(Boolean).join(' / ');
}

function resolveFolderInput(value) {
  var raw = (value || '').trim().toLowerCase();
  if (!raw) return null;
  return prodFolders.find(function(g) {
    return (g.id || '').toLowerCase() === raw
      || (g.name || '').toLowerCase() === raw
      || getFolderLabel(g).toLowerCase() === raw;
  }) || null;
}

function getUnfiledItems() {
  // All non-draft, non-routine-instance tasks + routines + notes without a folder, sorted by created_at desc
  var tasks = (prodAllTasks || []).filter(function(t) {
    return !t.draft && !t.routine_id && !t.folder_id;
  });
  var routines = (prodRoutines || []).filter(function(r) { return !r.folder_id; });
  var notes = (prodNotes || []).filter(function(n) { return !n.folder_id; });
  var items = [];
  tasks.forEach(function(t) { items.push({type: 'task', id: t.task_id, name: t.name, assign: t.assign_datetime, due: t.due_datetime, done: !!t.end_datetime, created_at: t.created_at || ''}); });
  routines.forEach(function(r) { items.push({type: 'routine', id: r.id, name: r.name, due: null, done: false, created_at: r.created_at || ''}); });
  notes.forEach(function(n) { items.push({type: 'note', id: n.id, name: n.name, due: n.date, done: false, created_at: n.created_at || ''}); });
  items.sort(function(a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
  return items;
}

function getFolderItems(folderId) {
  var tasks = (prodAllTasks || []).filter(function(t) {
    return !t.draft && !t.routine_id && t.folder_id === folderId;
  });
  var routines = (prodRoutines || []).filter(function(r) { return r.folder_id === folderId; });
  var notes = (prodNotes || []).filter(function(n) { return n.folder_id === folderId; });
  var items = [];
  tasks.forEach(function(t) { items.push({type: 'task', id: t.task_id, name: t.name, assign: t.assign_datetime, due: t.due_datetime, done: !!t.end_datetime, created_at: t.created_at || ''}); });
  routines.forEach(function(r) { items.push({type: 'routine', id: r.id, name: r.name, due: null, done: false, created_at: r.created_at || ''}); });
  notes.forEach(function(n) { items.push({type: 'note', id: n.id, name: n.name, due: n.date, done: false, created_at: n.created_at || ''}); });
  items.sort(function(a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
  return items;
}

function renderFolderItemHtml(item) {
  if (!projectsShowCompleted && item.done) return '';
  if (!projectsShowNotes && item.type === 'note') return '';
  if (!isItemVisibleByTimeFilter(item)) return '';
  var doneClass = item.done ? ' folder-item-done' : '';
  var icon = item.type === 'routine' ? 'repeat' : (item.type === 'note' ? 'note' : 'task_alt');
  var dueHtml = '';
  if (item.type === 'note' && item.due) {
    dueHtml = '<span class="folder-item-due">' + escHtml(item.due) + '</span>';
  } else if (item.due) {
    dueHtml = '<span class="folder-item-due">' + formatDateTime(item.due) + '</span>';
  }
  return '<div class="folder-item' + doneClass + '" draggable="true" data-item-id="' + item.id + '" data-item-type="' + item.type + '"' +
    ' ondragstart="onFolderItemDragStart(event)" ondragend="onFolderItemDragEnd(event)">' +
    '<span class="material-symbols-outlined folder-item-icon">' + icon + '</span>' +
    '<span class="folder-item-name">' + escHtml(item.name) + '</span>' + dueHtml + '</div>';
}

function getRootFolders() {
  return prodFolders.filter(function(g) { return !g.parent_id; });
}

function getChildFolders(parentId) {
  return prodFolders.filter(function(g) { return g.parent_id === parentId; });
}

// === Layout Algorithm ===
var LY_TOP_COLS = 4;
var LY_EST_ITEM_H = 34;
var LY_EST_HEADER_H = 36;
var LY_GAP = 16;
var projectsNeedsReorganize = false;

function getVisibleItems(folderId) {
  return getFolderItems(folderId).filter(function(item) {
    if (!projectsShowCompleted && item.done) return false;
    if (!projectsShowNotes && item.type === 'note') return false;
    if (!isItemVisibleByTimeFilter(item)) return false;
    return true;
  });
}

function buildFolderTree() {
  var nodeMap = {};
  prodFolders.forEach(function(g) {
    nodeMap[g.id] = { folder: g, children: [], items: getVisibleItems(g.id) };
  });
  prodFolders.forEach(function(g) {
    if (g.parent_id && nodeMap[g.parent_id]) nodeMap[g.parent_id].children.push(nodeMap[g.id]);
  });
  var roots = [];
  prodFolders.forEach(function(g) {
    if (!g.parent_id) roots.push(nodeMap[g.id]);
  });
  if (!projectsShowEmptyFolders) {
    function hasContent(node) {
      if (node.items.length > 0) return true;
      for (var i = 0; i < node.children.length; i++) {
        if (hasContent(node.children[i])) return true;
      }
      return false;
    }
    function prune(node) {
      node.children = node.children.filter(function(child) {
        prune(child);
        return hasContent(child);
      });
    }
    roots.forEach(prune);
    roots = roots.filter(hasContent);
  }
  return roots;
}

function countAllItems(node) {
  var count = node.items.length;
  for (var i = 0; i < node.children.length; i++) count += countAllItems(node.children[i]);
  return count;
}

// === Visual mode constants ===
var VIS_MAX_DISPLAY_ITEMS = 5; // max items shown per card
var VIS_D2_FIXED_H = LY_EST_HEADER_H + VIS_MAX_DISPLAY_ITEMS * LY_EST_ITEM_H + 20; // depth-2 card fixed height
var VIS_CATCHALL_FIXED_H = VIS_MAX_DISPLAY_ITEMS * LY_EST_ITEM_H + 20; // catchall (no header)
var VIS_BOX_PAD = 20; // body padding + border for depth-1 cards

// === Tree helpers ===
function findNodeById(nodes, folderId) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].folder.id === folderId) return nodes[i];
    var found = findNodeById(nodes[i].children, folderId);
    if (found) return found;
  }
  return null;
}

function buildFocusedTree(focusId) {
  var allRoots = buildFolderTree();
  if (!focusId) {
    return { focusFolder: null, children: allRoots, directItems: getVisibleUnfiledItems() };
  }
  var focusNode = findNodeById(allRoots, focusId);
  if (!focusNode) {
    projectsFocusPath = null;
    return { focusFolder: null, children: allRoots, directItems: getVisibleUnfiledItems() };
  }
  return { focusFolder: focusNode.folder, children: focusNode.children, directItems: focusNode.items };
}

function getVisibleUnfiledItems() {
  return getUnfiledItems().filter(function(item) {
    if (!projectsShowCompleted && item.done) return false;
    if (!projectsShowNotes && item.type === 'note') return false;
    if (!isItemVisibleByTimeFilter(item)) return false;
    return true;
  });
}

// === Render items with limit (shows first N-1 + "+X more") ===
function renderItemsWithLimit(items, subfolders, limit) {
  // Merge subfolders (depth 3+) as item-like entries, then real items
  var allEntries = [];
  (subfolders || []).forEach(function(sg) {
    allEntries.push({ _isSubfolder: true, folder: sg.folder, _totalItems: countAllItems(sg) });
  });
  items.forEach(function(item) { allEntries.push(item); });

  var html = '';
  var total = allEntries.length;
  var showCount = total <= limit ? total : limit - 1;
  for (var i = 0; i < showCount; i++) {
    var entry = allEntries[i];
    if (entry._isSubfolder) {
      html += renderSubfolderAsItem(entry);
    } else {
      html += renderFolderItemHtml(entry);
    }
  }
  if (total > limit) {
    var remaining = total - showCount;
    html += '<div class="folder-item folder-item-more">+' + remaining + ' more</div>';
  }
  return html;
}

function renderSubfolderAsItem(entry) {
  var id = escHtml(entry.folder.id);
  return '<div class="folder-item folder-item-subfolder" ondblclick="event.stopPropagation();projectsZoomIn(\'' + id + '\')">' +
    '<span class="material-symbols-outlined folder-item-icon">folder</span>' +
    '<span class="folder-item-name">' + escHtml(entry.folder.name) + '</span>' +
    '<span class="folder-item-due" style="color:#80868b">' + entry._totalItems + '</span></div>';
}

// === Depth-2 card (small, fixed height, 1 col) ===
function renderDepth2Card(node) {
  var folder = node.folder;
  var folderColor = escHtml(folder.color || DEFAULT_COLOR);
  // Depth-3+ children become items with folder icons
  var depth3Folders = node.children || [];
  var items = node.items || [];
  var bodyHtml = renderItemsWithLimit(items, depth3Folders, VIS_MAX_DISPLAY_ITEMS);

  return '<div class="folder-box folder-box-d2" data-folder-id="' + escHtml(folder.id) +
    '" style="--folder-color:' + folderColor + ';border-color:' + folderColor +
    ';height:' + VIS_D2_FIXED_H + 'px"' +
    ' ondblclick="event.stopPropagation();projectsZoomIn(\'' + escHtml(folder.id) + '\')"' +
    ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
    '<div class="folder-box-header">' +
    '<span class="folder-box-name">' + escHtml(folder.name) + '</span>' +
    '<div class="folder-box-actions" onclick="event.stopPropagation()">' +
    '<button class="folder-box-actions-btn" onclick="event.stopPropagation();toggleFolderDropdown(this)"><span class="material-symbols-outlined">more_vert</span></button>' +
    '<div class="folder-box-dropdown">' +
    '<button class="folder-box-dd-item" onclick="event.stopPropagation();editFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">edit</span> Edit</button>' +
    '<button class="folder-box-dd-item danger" onclick="event.stopPropagation();deleteFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">delete</span> Delete</button>' +
    '</div></div></div>' +
    '<div class="folder-box-body">' + bodyHtml + '</div></div>';
}

// === Catchall card (no header, for direct items) ===
function renderCatchallCard(items, parentId) {
  var bodyHtml = renderItemsWithLimit(items, [], VIS_MAX_DISPLAY_ITEMS);
  return '<div class="folder-box-catchall" data-folder-id="' + escHtml(parentId || '') + '"' +
    ' style="height:' + VIS_CATCHALL_FIXED_H + 'px"' +
    ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
    '<div class="folder-box-body">' + bodyHtml + '</div></div>';
}

// === Depth-1 card (large, contains depth-2 grid) ===
function renderDepth1Card(node, directItems) {
  var folder = node.folder;
  var folderColor = escHtml(folder.color || DEFAULT_COLOR);
  var depth2Children = node.children || [];
  var hasDirectItems = directItems && directItems.length > 0;
  // Only use catchall card when there are BOTH subfolders and direct items
  // Count depth-2 slots: subfolders + 1 for direct items if both exist
  var hasMixedContent = hasDirectItems && depth2Children.length > 0;
  var numD2 = depth2Children.length + (hasMixedContent ? 1 : 0);
  var cols = Math.min(numD2, LY_TOP_COLS);
  if (cols < 1) cols = 1;
  node.layoutCols = cols;

  // Height: always use depth-2 card row height (min 1 row so all depth-1 cards match)
  var rows = Math.max(Math.ceil(numD2 / cols), 1);
  var innerCardH = VIS_D2_FIXED_H;
  var d1Height = LY_EST_HEADER_H + rows * (innerCardH + LY_GAP) - LY_GAP + VIS_BOX_PAD;

  // Render inner content
  var innerHtml = '';
  if (depth2Children.length === 0 && hasDirectItems) {
    // No subfolders — render items directly in body (no wrapper)
    innerHtml = renderItemsWithLimit(directItems, [], VIS_MAX_DISPLAY_ITEMS);
  } else {
    depth2Children.forEach(function(child) {
      innerHtml += renderDepth2Card(child);
    });
    if (hasMixedContent) {
      // Direct items alongside subfolders — render without catchall styling
      var catchallBody = renderItemsWithLimit(directItems, [], VIS_MAX_DISPLAY_ITEMS);
      innerHtml += '<div style="height:' + VIS_D2_FIXED_H + 'px;overflow:hidden"' +
        ' data-folder-id="' + escHtml(folder.id) + '"' +
        ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
        '<div class="folder-box-body">' + catchallBody + '</div></div>';
    }
  }

  return '<div class="folder-box" data-folder-id="' + escHtml(folder.id) +
    '" style="--folder-color:' + folderColor + ';border-color:' + folderColor + ';min-height:' + d1Height + 'px"' +
    ' ondblclick="projectsZoomIn(\'' + escHtml(folder.id) + '\')"' +
    ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
    '<div class="folder-box-header">' +
    '<span class="folder-box-name">' + escHtml(folder.name) + '</span>' +
    '<div class="folder-box-actions" onclick="event.stopPropagation()">' +
    '<button class="folder-box-actions-btn" onclick="event.stopPropagation();toggleFolderDropdown(this)"><span class="material-symbols-outlined">more_vert</span></button>' +
    '<div class="folder-box-dropdown">' +
    '<button class="folder-box-dd-item" onclick="event.stopPropagation();editFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">edit</span> Edit</button>' +
    '<button class="folder-box-dd-item danger" onclick="event.stopPropagation();deleteFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">delete</span> Delete</button>' +
    '</div></div></div>' +
    '<div class="folder-box-body layout-packed-body" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
    innerHtml + '</div></div>';
}

// === Visual mode masonry ===
function estimateDepth1Height(node, directItems) {
  var depth2Children = node.children || [];
  var hasDirectItems = directItems && directItems.length > 0;
  var hasMixedContent = hasDirectItems && depth2Children.length > 0;
  var numD2 = depth2Children.length + (hasMixedContent ? 1 : 0);
  var cols = Math.min(numD2, LY_TOP_COLS);
  if (cols < 1) cols = 1;
  var rows = Math.max(Math.ceil(numD2 / cols), 1);
  var innerCardH = VIS_D2_FIXED_H;
  return LY_EST_HEADER_H + rows * (innerCardH + LY_GAP) - LY_GAP + VIS_BOX_PAD;
}

function renderProjectsVisual() {
  var el = document.getElementById('prod-projects'); if (!el) return;
  var focused = buildFocusedTree(projectsFocusPath);
  var depth1Nodes = focused.children;
  var directItems = focused.directItems;

  if (depth1Nodes.length === 0 && directItems.length === 0) {
    el.innerHTML = '<p class="prod-empty">No folders here. Right-click and select "Folder" to create one.</p>';
    return;
  }

  // Build render list: each depth-1 node + catchall for root-level direct items
  var renderItems = []; // { html, cols, height }
  depth1Nodes.forEach(function(node) {
    var nodeDirectItems = node.items || [];
    var h = estimateDepth1Height(node, nodeDirectItems);
    var hasDirectItems = nodeDirectItems.length > 0;
    var hasCatchall = hasDirectItems && node.children.length > 0;
    var numD2 = node.children.length + (hasCatchall ? 1 : 0);
    // Items-only cards (no subfolders) take 1 column
    var cols = numD2 > 0 ? Math.min(numD2, LY_TOP_COLS) : 1;
    renderItems.push({ html: renderDepth1Card(node, nodeDirectItems), cols: cols, height: h });
  });

  // Root-level direct items: place individually into masonry (no wrapper)
  directItems.forEach(function(item) {
    var itemHtml = renderFolderItemHtml(item);
    if (itemHtml) {
      renderItems.push({ html: itemHtml, cols: 1, height: LY_EST_ITEM_H });
    }
  });

  // Sort tallest first for better packing
  renderItems.sort(function(a, b) { return b.height - a.height; });

  // Absolute-positioned masonry
  var colH = [0, 0, 0, 0];
  var placements = [];

  renderItems.forEach(function(item) {
    var span = Math.min(item.cols, LY_TOP_COLS);
    var bestStart = 0, bestY = Infinity;
    for (var s = 0; s <= LY_TOP_COLS - span; s++) {
      var maxY = 0;
      for (var c = s; c < s + span; c++) {
        if (colH[c] > maxY) maxY = colH[c];
      }
      if (maxY < bestY) { bestY = maxY; bestStart = s; }
    }
    placements.push({ html: item.html, col: bestStart, top: bestY, span: span });
    var newH = bestY + item.height + LY_GAP;
    for (var c = bestStart; c < bestStart + span; c++) colH[c] = newH;
  });

  var maxH = 0;
  for (var i = 0; i < LY_TOP_COLS; i++) { if (colH[i] > maxH) maxH = colH[i]; }

  var html = '<div style="position:relative;min-height:' + maxH + 'px">';
  placements.forEach(function(p) {
    var leftCalc = p.col === 0 ? '0' : 'calc(' + (p.col * 25) + '% + ' + (p.col * 2.5) + 'px)';
    var widthCalc = p.span === LY_TOP_COLS ? '100%' : 'calc(' + (p.span * 25) + '% + ' + (p.span * 2.5 - 10) + 'px)';
    html += '<div style="position:absolute;top:' + p.top + 'px;left:' + leftCalc + ';width:' + widthCalc + '">';
    html += p.html;
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

// === List mode ===
function renderProjectsList() {
  var el = document.getElementById('prod-projects'); if (!el) return;
  var roots = buildFolderTree();
  var ungrouped = getVisibleUnfiledItems();
  var rootLabel = userEmail || 'Projects';

  var html = '<div class="list-tree-node">';
  // Root row (always expanded)
  html += '<div class="list-tree-row" onclick="toggleListNode(this)">';
  html += '<span class="list-tree-chevron expanded material-symbols-outlined">chevron_right</span>';
  html += '<span class="list-tree-icon list-tree-icon-folder material-symbols-outlined">folder</span>';
  html += '<span class="list-tree-name">' + escHtml(rootLabel) + '</span>';
  html += '</div>';
  html += '<div class="list-tree-children">';
  roots.forEach(function(node) { html += renderListTreeNode(node, 1); });
  ungrouped.forEach(function(item) { html += renderListTreeItem(item, 1); });
  html += '</div></div>';

  el.innerHTML = html;
}

function renderListTreeNode(node, depth) {
  var folder = node.folder;
  var items = node.items || [];
  var children = node.children || [];
  var totalItems = countAllItems(node);
  var indent = depth * 20;
  var hasChildren = children.length > 0 || items.length > 0;
  var colorDot = (folder.color && folder.color !== '#000000' && folder.color !== DEFAULT_COLOR)
    ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + escHtml(folder.color) + ';margin-right:2px;flex-shrink:0"></span>' : '';

  var html = '<div class="list-tree-node" data-folder-id="' + escHtml(folder.id) + '"' +
    ' ondragover="onListTreeDragOver(event)" ondragleave="onListTreeDragLeave(event)" ondrop="onListTreeDrop(event)">';
  html += '<div class="list-tree-row" onclick="toggleListNode(this)" ondblclick="projectsZoomIn(\'' + escHtml(folder.id) + '\')">';
  html += '<span style="width:' + indent + 'px" class="list-tree-indent"></span>';
  if (hasChildren) {
    html += '<span class="list-tree-chevron material-symbols-outlined">chevron_right</span>';
  } else {
    html += '<span style="width:20px" class="list-tree-indent"></span>';
  }
  html += colorDot;
  html += '<span class="list-tree-icon list-tree-icon-folder material-symbols-outlined">folder</span>';
  html += '<span class="list-tree-name">' + escHtml(folder.name) + '</span>';
  if (totalItems > 0) html += '<span class="list-tree-count">(' + totalItems + ')</span>';
  html += '</div>';

  if (hasChildren) {
    html += '<div class="list-tree-children" style="display:none">';
    children.forEach(function(child) { html += renderListTreeNode(child, depth + 1); });
    items.forEach(function(item) { html += renderListTreeItem(item, depth + 1); });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderListTreeItem(item, depth) {
  if (!projectsShowCompleted && item.done) return '';
  if (!projectsShowNotes && item.type === 'note') return '';
  if (!isItemVisibleByTimeFilter(item)) return '';
  var indent = depth * 20 + 20; // extra 20 for no chevron
  var icon = item.type === 'routine' ? 'repeat' : (item.type === 'note' ? 'note' : 'task_alt');
  var doneClass = item.done ? ' folder-item-done' : '';
  return '<div class="list-tree-item' + doneClass + '" draggable="true" data-item-id="' + item.id + '" data-item-type="' + item.type + '"' +
    ' ondragstart="onFolderItemDragStart(event)" ondragend="onFolderItemDragEnd(event)">' +
    '<span style="width:' + indent + 'px" class="list-tree-indent"></span>' +
    '<span class="list-tree-icon material-symbols-outlined">' + icon + '</span>' +
    '<span class="list-tree-name">' + escHtml(item.name) + '</span></div>';
}

function toggleListNode(rowEl) {
  var node = rowEl.closest('.list-tree-node');
  if (!node) return;
  var children = node.querySelector(':scope > .list-tree-children');
  var chevron = rowEl.querySelector('.list-tree-chevron');
  if (!children) return;
  var isOpen = children.style.display !== 'none';
  children.style.display = isOpen ? 'none' : '';
  if (chevron) chevron.classList.toggle('expanded', !isOpen);
}

// List mode drag-drop on tree nodes
function onListTreeDragOver(e) {
  e.preventDefault();
  var node = e.target.closest('.list-tree-node');
  if (node) node.querySelector('.list-tree-row').style.background = '#e8f0fe';
}
function onListTreeDragLeave(e) {
  var node = e.target.closest('.list-tree-node');
  if (node && !node.contains(e.relatedTarget)) node.querySelector('.list-tree-row').style.background = '';
}
function onListTreeDrop(e) {
  e.preventDefault(); e.stopPropagation();
  var node = e.target.closest('.list-tree-node');
  if (!node || !folderDraggedItemId) return;
  node.querySelector('.list-tree-row').style.background = '';
  var targetFolderId = node.dataset.folderId;
  if (targetFolderId) assignItemFolder(folderDraggedItemId, folderDraggedItemType, targetFolderId);
}

// === Main render dispatcher ===
function renderProjects() {
  var el = document.getElementById('prod-projects'); if (!el) return;
  if (projectsViewMode === 'list') {
    renderProjectsList();
  } else {
    renderProjectsVisual();
  }
}

function renderProjectsInPlace() {
  renderProjects();
}

// --- Group box interactions ---
function toggleFolderCollapse(headerEl) {
  var body = headerEl.nextElementSibling;
  var toggle = headerEl.querySelector('.folder-box-toggle');
  if (body) body.classList.toggle('collapsed');
  if (toggle) toggle.classList.toggle('collapsed');
}

function toggleFolderDropdown(btn) {
  var dd = btn.nextElementSibling;
  // Close others
  document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  if (dd) dd.classList.toggle('open');
}

// Close folder dropdowns on click outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.folder-box-actions')) {
    document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  }
});

function deleteFolder(folderId) {
  document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  var folder = getFolderById(folderId);
  var label = folder ? getFolderLabel(folder) : folderId;
  if (!confirm('Delete folder "' + label + '" and all subfolders? Items will become unclassified.')) return;
  fetch('/api/folders', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: folderId})})
    .then(function(r) { if (!r.ok) throw 0; return r.json(); })
    .then(function() { refreshData(); })
    .catch(function() { alert('Failed to delete folder.'); });
}

function editFolder(folderId) {
  document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  var folder = getFolderById(folderId);
  if (!folder) return;
  openFolderModal(folder);
}

// --- Drag and drop for folders ---
var folderDraggedItemId = null;
var folderDraggedItemType = null;

function onFolderItemDragStart(e) {
  var el = e.target.closest('.folder-item');
  if (!el) return;
  folderDraggedItemId = el.dataset.itemId;
  folderDraggedItemType = el.dataset.itemType;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', folderDraggedItemId);
  var ws = document.getElementById('projects-whitespace');
  if (ws) ws.classList.add('drag-active');
}

function onFolderItemDragEnd(e) {
  var el = e.target.closest('.folder-item');
  if (el) el.classList.remove('dragging');
  folderDraggedItemId = null;
  folderDraggedItemType = null;
  document.querySelectorAll('.folder-box.drag-over-folder').forEach(function(b) { b.classList.remove('drag-over-folder'); });
  var ws = document.getElementById('projects-whitespace');
  if (ws) ws.classList.remove('drag-active', 'drag-over');
}

function onFolderBoxDragOver(e) {
  e.preventDefault();
  var box = e.target.closest('.folder-box');
  if (box) box.classList.add('drag-over-folder');
}

function onFolderBoxDragLeave(e) {
  var box = e.target.closest('.folder-box');
  if (box && !box.contains(e.relatedTarget)) box.classList.remove('drag-over-folder');
}

function onFolderBoxDrop(e) {
  e.preventDefault(); e.stopPropagation();
  var box = e.target.closest('.folder-box');
  if (!box || !folderDraggedItemId) return;
  box.classList.remove('drag-over-folder');
  var targetFolderId = box.dataset.folderId;
  assignItemFolder(folderDraggedItemId, folderDraggedItemType, targetFolderId);
}

function onProjectsWhitespaceDragOver(e) {
  e.preventDefault();
  e.target.classList.add('drag-over');
}
function onProjectsWhitespaceDragLeave(e) {
  e.target.classList.remove('drag-over');
}
function onProjectsWhitespaceDrop(e) {
  e.preventDefault();
  e.target.classList.remove('drag-over', 'drag-active');
  if (!folderDraggedItemId) return;
  assignItemFolder(folderDraggedItemId, folderDraggedItemType, null);
}

function assignItemFolder(itemId, itemType, folderId) {
  if (itemType === 'routine') {
    fetch('/api/routines/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({folder_id: folderId})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign routine to folder.'); });
  } else if (itemType === 'note') {
    fetch('/api/notes/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({folder_id: folderId})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign note to folder.'); });
  } else {
    fetch('/api/tasks/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({folder_id: folderId})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign task to folder.'); });
  }
}

function toggleNoteDropdown(btn, noteId) {
  var existing = document.querySelector('.note-dropdown-menu');
  if (existing) { existing.remove(); return; }
  var menu = document.createElement('div');
  menu.className = 'note-dropdown-menu';
  menu.innerHTML = '<button onclick="editNote(\'' + noteId + '\');this.parentNode.remove()"><span class="material-symbols-outlined" style="font-size:16px">edit</span> Edit</button>' +
    '<button onclick="deleteNote(\'' + noteId + '\');this.parentNode.remove()"><span class="material-symbols-outlined" style="font-size:16px">delete</span> Delete</button>';
  btn.parentNode.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); }
    });
  }, 0);
}

// --- Group creation modal (factory) ---
var GA_PALETTE = [
  '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#efefef','#f3f3f3','#ffffff',
  '#980000','#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff',
  '#e6b8af','#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3','#c9daf8','#cfe2f3','#d9d2e9','#ead1dc',
  '#dd7e6b','#ea9999','#f9cb9c','#ffe599','#b6d7a8','#a2c4c9','#a4c2f4','#9fc5e8','#b4a7d6','#d5a6bd',
  '#cc4125','#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6d9eeb','#6fa8dc','#8e7cc3','#c27ba0',
  '#a61c00','#cc0000','#e69138','#f1c232','#6aa84f','#45818e','#3c78d8','#3d85c6','#674ea7','#a64d79',
  '#85200c','#990000','#b45f06','#bf9000','#38761d','#134f5c','#1155cc','#0b5394','#351c75','#741b47',
  '#5b0f00','#660000','#783f04','#7f6000','#274e13','#0c343d','#1c4587','#073763','#20124d','#4c1130'
];

function createFolderCard(existingFolder) {
  var editingFolderId = existingFolder ? existingFolder.id : null;
  var selectedColor = existingFolder ? (existingFolder.color || DEFAULT_COLOR) : DEFAULT_COLOR;
  var draftId = null;
  var draftSaveTimer = null;

  var cardEl = document.createElement('div');
  cardEl.className = 'quickadd-card';
  cardEl.innerHTML =
    '<div class="quickadd-header ga-header">Group</div>' +
    '<div class="quickadd-body">' +
      '<input class="quickadd-input gm-name" placeholder="Folder name" autocomplete="off">' +
      '<select class="quickadd-input gm-parent"></select>' +
      '<div class="ga-color-btn">' +
        '<div class="ga-color-circle"></div>' +
      '</div>' +
    '</div>' +
    '<div class="ga-color-picker" style="display:none">' +
      '<div class="ga-palette"></div>' +
      '<div class="ga-hex-row">' +
        '<label>Hex</label>' +
        '<input type="text" class="ga-hex-input" placeholder="#000000" maxlength="7" autocomplete="off">' +
      '</div>' +
    '</div>';

  var header = _q(cardEl, 'ga-header');
  var nameInput = _q(cardEl, 'gm-name');
  var parentSelect = _q(cardEl, 'gm-parent');
  var circle = _q(cardEl, 'ga-color-circle');
  var colorBtn = _q(cardEl, 'ga-color-btn');
  var colorPicker = _q(cardEl, 'ga-color-picker');
  var paletteEl = _q(cardEl, 'ga-palette');
  var hexInput = _q(cardEl, 'ga-hex-input');

  header.textContent = existingFolder ? 'Edit Folder' : 'Group';

  if (existingFolder) {
    nameInput.value = existingFolder.name || '';
  }

  parentSelect.innerHTML = '<option value="">No parent</option>' + prodFolders
    .filter(function(g) { return !existingFolder || g.id !== existingFolder.id; })
    .map(function(g) {
      return '<option value="' + escHtml(g.id) + '"' + (existingFolder && existingFolder.parent_id === g.id ? ' selected' : '') + '>' + escHtml(getFolderLabel(g)) + '</option>';
    }).join('');

  function updateCardColor() {
    if (circle) circle.style.backgroundColor = selectedColor;
    cardEl.style.borderColor = selectedColor;
    cardEl.style.setProperty('--qa-border-color', selectedColor);
    header.style.backgroundColor = selectedColor;
  }

  function selectColor(color) {
    selectedColor = color;
    updateCardColor();
    hexInput.value = color;
    cardEl.querySelectorAll('.ga-swatch.selected').forEach(function(s) { s.classList.remove('selected'); });
    var match = cardEl.querySelector('.ga-swatch[data-color="' + color + '"]');
    if (match) match.classList.add('selected');
    colorPicker.style.display = 'none';
  }

  updateCardColor();

  // Build palette
  paletteEl.innerHTML = GA_PALETTE.map(function(c) {
    return '<div class="ga-swatch' + (c === selectedColor ? ' selected' : '') + '" style="background:' + c + '" data-color="' + c + '"></div>';
  }).join('');
  paletteEl.addEventListener('click', function(e) {
    var swatch = e.target.closest('.ga-swatch');
    if (swatch && swatch.dataset.color) selectColor(swatch.dataset.color);
  });

  hexInput.value = selectedColor;
  hexInput.oninput = function() {
    var v = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      selectedColor = v;
      updateCardColor();
      cardEl.querySelectorAll('.ga-swatch.selected').forEach(function(s) { s.classList.remove('selected'); });
    }
  };

  colorBtn.addEventListener('click', function() {
    colorPicker.style.display = colorPicker.style.display === 'none' ? '' : 'none';
  });

  // Draft auto-save for groups (not when editing existing)
  function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(saveFolderDraft, 2000);
  }
  var draftCreated = false;
  function saveFolderDraft() {
    if (!draftId) return;
    var nameVal = nameInput.value.trim() || '';
    if (!nameVal && !draftCreated) return; // don't create draft for empty content
    var data = {
      name: nameVal,
      draft_type: 'folder',
      parent_id: parentSelect.value || null,
      color: selectedColor
    };
    if (!draftCreated) {
      draftCreated = true;
      fetch('/api/drafts', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({draft_id: draftId}, data))});
    } else {
      fetch('/api/drafts/' + draftId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    }
  }

  if (existingFolder && existingFolder._draftId) {
    // Resuming a draft — reuse existing draft ID
    draftId = existingFolder._draftId;
    draftCreated = true;
    editingFolderId = null;
    nameInput.addEventListener('input', scheduleDraftSave);
    parentSelect.addEventListener('change', scheduleDraftSave);
  } else if (!existingFolder) {
    draftId = crypto.randomUUID ? crypto.randomUUID() : 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    nameInput.addEventListener('input', scheduleDraftSave);
    parentSelect.addEventListener('change', scheduleDraftSave);
  }

  var card = {
    type: 'folder',
    el: cardEl,
    draftId: draftId,
    _onOverlayKeydown: function(e) {
      // Don't submit on Enter inside hex input
      if (e.key === 'Enter' && document.activeElement === hexInput) { e.stopPropagation(); e.preventDefault(); return; }
    },
    onSubmit: function() { saveThisFolder(); },
    onDismiss: function() {
      if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; }
      if (draftId && draftCreated) {
        var hasContent = nameInput.value.trim();
        if (!hasContent) {
          fetch('/api/drafts/' + draftId, {method: 'DELETE'});
        } else {
          saveFolderDraft();
        }
      }
    }
  };

  function saveThisFolder() {
    var name = nameInput.value.trim();
    var parentId = parentSelect.value || null;
    var color = selectedColor || DEFAULT_COLOR;
    if (!name) { alert('Name is required.'); nameInput.focus(); return; }

    if (editingFolderId) {
      fetch('/api/folders', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: editingFolderId, name: name, parent_id: parentId, color: color})})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() { CardStack.remove(card); refreshData(); })
        .catch(function(err) { alert(err.message || 'Failed.'); });
    } else {
      var siblings = parentId ? getChildFolders(parentId) : getRootFolders();
      if (siblings.length >= 12) { alert('A folder can have at most 12 subfolders.'); return; }
      fetch('/api/folders', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: name, parent_id: parentId, color: color})})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() {
          if (draftId) fetch('/api/drafts/' + draftId, {method: 'DELETE'});
          CardStack.remove(card);
          refreshData();
        })
        .catch(function(err) { alert(err.message || 'Failed.'); });
    }
  }

  return card;
}

function openFolderModal(existingFolder) {
  CardStack.push(createFolderCard(existingFolder));
}

function closeFolderModal() {
  CardStack.dismissTop();
}

// --- Pattern helpers (new format: "set:0,1,3" or "interval:2") ---
var PATTERN_DAY_LETTERS = ['M','T','W','R','F','S','U']; // index 0-6 = Mon-Sun

function patternToDisplay(pattern) {
  if (!pattern) return '';
  if (pattern === 'interval:1') return 'Daily';
  if (pattern === 'set:0,1,2,3,4') return 'Weekdays';
  if (pattern === 'set:5,6') return 'Weekends';
  if (pattern.startsWith('interval:')) return 'Every ' + pattern.split(':')[1] + ' days';
  if (pattern.startsWith('set:')) {
    var days = pattern.split(':')[1].split(',').map(Number);
    return '{' + days.map(function(d) { return PATTERN_DAY_LETTERS[d]; }).join(', ') + '}';
  }
  return pattern;
}

function parsePatternInput(text) {
  text = text.trim().toLowerCase();
  var dayMap = {mon:0,tue:1,wed:2,thu:3,fri:4,sat:5,sun:6,
    monday:0,tuesday:1,wednesday:2,thursday:3,friday:4,saturday:5,sunday:6};

  if (text === 'daily' || text === 'every day') return 'interval:1';
  if (text === 'weekdays' || text === 'every weekday') return 'set:0,1,2,3,4';
  if (text === 'weekends' || text === 'every weekend' || text === 'weekend') return 'set:5,6';

  // "every N days"
  var nMatch = text.match(/^every\s+(\d+)\s+days?$/);
  if (nMatch) {
    var nVal = parseInt(nMatch[1]);
    if (nVal < 1) nVal = 1;
    if (nVal > 30) nVal = 30;
    return 'interval:' + nVal;
  }

  // "every mon tue fri" or "every monday tuesday friday"
  var everyMatch = text.match(/^every\s+(.+)$/);
  if (everyMatch) {
    var parts = everyMatch[1].split(/\s+/);
    var parsedDays = [];
    for (var pi = 0; pi < parts.length; pi++) {
      if (parts[pi] in dayMap) parsedDays.push(dayMap[parts[pi]]);
    }
    if (parsedDays.length > 0) {
      parsedDays.sort(function(a,b){ return a-b; });
      // Deduplicate
      var unique = [];
      for (var ui = 0; ui < parsedDays.length; ui++) {
        if (unique.indexOf(parsedDays[ui]) < 0) unique.push(parsedDays[ui]);
      }
      if (unique.length === 7) return 'interval:1';
      return 'set:' + unique.join(',');
    }
  }

  return null; // unrecognized
}

function getForwardBoundary() {
  // Forward boundary: last day of (current_month + 2)
  var now = new Date();
  var m = now.getMonth() + 3; // 0-based + 2 + 1 for next month day 0 trick
  var y = now.getFullYear();
  while (m > 12) { m -= 12; y++; }
  // Day 0 of month m+1 = last day of month m
  var last = new Date(y, m, 0);
  return fmtDate(last);
}

function computeMaxInstancesClientSide(firstDay, pattern) {
  var boundary = getForwardBoundary();
  var d = new Date(firstDay + 'T00:00:00');
  var end = new Date(boundary + 'T00:00:00');
  if (isNaN(d.getTime()) || isNaN(end.getTime())) return 85;
  var firstDayDate = new Date(firstDay + 'T00:00:00');
  var count = 0;
  while (d <= end) {
    if (patternMatchesDateJS(pattern, firstDayDate, d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function patternMatchesDateJS(pattern, firstDayDate, checkDate) {
  if (pattern.startsWith('interval:')) {
    var n = parseInt(pattern.split(':')[1]);
    if (n < 1) n = 1;
    var diffDays = Math.round((checkDate - firstDayDate) / 86400000);
    return diffDays % n === 0;
  }
  if (pattern.startsWith('set:')) {
    var days = pattern.split(':')[1].split(',').map(Number);
    // JS getDay: 0=Sun...6=Sat -> convert to Python: 0=Mon...6=Sun
    var jsDay = checkDate.getDay();
    var pyDay = jsDay === 0 ? 6 : jsDay - 1;
    return days.indexOf(pyDay) >= 0;
  }
  return false;
}

function clampInstances() {
  var inp = document.getElementById('sm-max-instances');
  var val = parseInt(inp.value);
  if (isNaN(val) || val < 1) return; // let user keep typing
  if (val < 2) { inp.value = 2; return; }
  var maxAttr = parseInt(inp.max);
  if (maxAttr && val > maxAttr) inp.value = maxAttr;
}

function setPatternInModal(pattern) {
  // Set the pattern select, hidden value, and show appropriate sub-controls
  var patternSel = document.getElementById('sm-pattern');
  var hiddenVal = document.getElementById('sm-pattern-value');
  var dayPicker = document.getElementById('sm-pattern-day-picker');
  var intervalInput = document.getElementById('sm-pattern-interval-input');
  var instancesInput = document.getElementById('sm-max-instances');

  hiddenVal.value = pattern;
  dayPicker.style.display = 'none';
  intervalInput.style.display = 'none';

  // Check if pattern matches a standard select option
  var found = false;
  for (var si = 0; si < patternSel.options.length; si++) {
    if (patternSel.options[si].value === pattern) { found = true; break; }
  }
  if (found) {
    patternSel.value = pattern;
  } else if (pattern.startsWith('set:')) {
    patternSel.value = 'custom-set';
    dayPicker.style.display = 'block';
    // Set toggle buttons
    var setDays = pattern.split(':')[1].split(',').map(Number);
    var toggleBtns = document.querySelectorAll('.sm-day-toggle');
    for (var ti = 0; ti < toggleBtns.length; ti++) {
      var dayNum = parseInt(toggleBtns[ti].getAttribute('data-day'));
      if (setDays.indexOf(dayNum) >= 0) {
        toggleBtns[ti].classList.remove('secondary');
        toggleBtns[ti].classList.add('primary');
      } else {
        toggleBtns[ti].classList.remove('primary');
        toggleBtns[ti].classList.add('secondary');
      }
    }
  } else if (pattern.startsWith('interval:')) {
    var nVal = parseInt(pattern.split(':')[1]);
    if (nVal === 1) {
      patternSel.value = 'interval:1';
    } else {
      patternSel.value = 'custom-interval';
      intervalInput.style.display = 'block';
      document.getElementById('sm-interval-n').value = nVal;
    }
  }

  // Enable instances
  instancesInput.disabled = false;
  autoComputeMaxIfReady();
}

function togglePatternDay(btn) {
  if (btn.classList.contains('primary')) {
    btn.classList.remove('primary');
    btn.classList.add('secondary');
  } else {
    btn.classList.remove('secondary');
    btn.classList.add('primary');
  }
  updateDayPickerPattern();
}

function updateDayPickerPattern() {
  var toggleBtns = document.querySelectorAll('.sm-day-toggle');
  var selectedDays = [];
  for (var i = 0; i < toggleBtns.length; i++) {
    if (toggleBtns[i].classList.contains('primary')) {
      selectedDays.push(parseInt(toggleBtns[i].getAttribute('data-day')));
    }
  }
  selectedDays.sort(function(a,b){ return a-b; });
  var hiddenVal = document.getElementById('sm-pattern-value');
  var instancesInput = document.getElementById('sm-max-instances');
  if (selectedDays.length === 0) {
    hiddenVal.value = '';
    instancesInput.disabled = true;
    instancesInput.value = '';
  } else if (selectedDays.length === 7) {
    hiddenVal.value = 'interval:1';
    instancesInput.disabled = false;
    autoComputeMaxIfReady();
  } else {
    hiddenVal.value = 'set:' + selectedDays.join(',');
    instancesInput.disabled = false;
    autoComputeMaxIfReady();
  }
}

function updateIntervalPattern() {
  var nInput = document.getElementById('sm-interval-n');
  var nVal = parseInt(nInput.value);
  if (isNaN(nVal) || nVal < 1) nVal = 1;
  if (nVal > 30) nVal = 30;
  var hiddenVal = document.getElementById('sm-pattern-value');
  var instancesInput = document.getElementById('sm-max-instances');
  hiddenVal.value = 'interval:' + nVal;
  instancesInput.disabled = false;
  autoComputeMaxIfReady();
}

function autoComputeMaxIfReady() {
  var firstDayInput = document.getElementById('sm-first-day');
  var firstDay = firstDayInput.value;
  var pattern = document.getElementById('sm-pattern-value').value;
  var instancesInput = document.getElementById('sm-max-instances');
  // Push first_day forward for set patterns
  if (firstDay && pattern && pattern.startsWith('set:')) {
    var pushed = adjustFirstDayForPattern(firstDay, pattern);
    if (pushed !== firstDay) { firstDayInput.value = pushed; firstDay = pushed; }
  }
  if (firstDay && pattern) {
    var max = computeMaxInstancesClientSide(firstDay, pattern);
    if (max < 2) max = 2;
    instancesInput.max = max;
    var current = parseInt(instancesInput.value);
    if (!current || isNaN(current) || current > max) {
      instancesInput.value = max;
    } else if (current < 2) {
      instancesInput.value = 2;
    }
  }
}

function adjustFirstDayForPattern(firstDay, pattern) {
  // For set patterns: push first_day forward to the next matching weekday
  // For interval patterns: no push needed
  if (!pattern || !pattern.startsWith('set:')) return firstDay;
  var days = pattern.split(':')[1].split(',').map(Number);
  if (days.length === 0) return firstDay;
  var d = new Date(firstDay + 'T00:00:00');
  for (var attempt = 0; attempt < 7; attempt++) {
    // JS getDay: 0=Sun...6=Sat -> Python: 0=Mon...6=Sun
    var jsDay = d.getDay();
    var pyDay = jsDay === 0 ? 6 : jsDay - 1;
    if (days.indexOf(pyDay) >= 0) return fmtDate(d);
    d.setDate(d.getDate() + 1);
  }
  return firstDay;
}

// --- Natural Date Parser ---
// Resolve a day name with optional modifier to a date
// modifier: null/"this" = this week (today if same day, else next occurrence)
//           "next" = skip to next week's occurrence
//           "next next" = skip to week after next
function resolveDayName(text) {
  var todayLocal = getTodayStr();
  var parts = todayLocal.split('-').map(Number);
  var ty = parts[0], tm = parts[1], td = parts[2];
  var dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  var shortNames = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};

  var modifier = 0; // 0 = this, 1 = next, 2 = next next
  var cleaned = text.trim().toLowerCase();
  if (cleaned.startsWith('next next ')) { modifier = 2; cleaned = cleaned.slice(10).trim(); }
  else if (cleaned.startsWith('next ')) { modifier = 1; cleaned = cleaned.slice(5).trim(); }
  else if (cleaned.startsWith('this ')) { modifier = 0; cleaned = cleaned.slice(5).trim(); }

  var dayIdx = dayNames.indexOf(cleaned);
  if (dayIdx < 0 && cleaned in shortNames) dayIdx = shortNames[cleaned];
  if (dayIdx < 0) return null;

  var todayObj = new Date(ty, tm-1, td);
  var todayDay = todayObj.getDay(); // JS: 0=Sun...6=Sat
  var diff = dayIdx - todayDay;
  if (diff < 0) diff += 7; // next occurrence
  // If diff === 0 and modifier === 0, use today
  // If diff === 0 and modifier >= 1, jump ahead 7 * modifier
  if (diff === 0 && modifier > 0) diff = 7 * modifier;
  else diff += 7 * modifier;

  var result = new Date(ty, tm-1, td + diff);
  return fmtDate(result);
}

function parseNaturalDate(text, defaultTime) {
  text = text.trim().toLowerCase();
  var todayLocal = getTodayStr();
  var tParts = todayLocal.split('-').map(Number);
  var ty = tParts[0], tm = tParts[1], td = tParts[2];
  var date = null, time = null;

  // Extract trailing time if present
  var timeAtEnd = text.match(/\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$/i);
  if (timeAtEnd) { time = parseTimeStr(timeAtEnd[1]); text = text.slice(0, -timeAtEnd[0].length).trim(); }

  // Named dates
  if (text === 'today') date = todayLocal;
  else if (text === 'tomorrow') { var d1 = new Date(ty, tm-1, td+1); date = fmtDate(d1); }
  else if (text === 'day after tomorrow') { var d2 = new Date(ty, tm-1, td+2); date = fmtDate(d2); }
  else {
    var inDays = text.match(/^in\s+(\d+)\s+days?$/);
    if (inDays) { var d3 = new Date(ty, tm-1, td+parseInt(inDays[1])); date = fmtDate(d3); }
  }

  // Day names with modifiers: "thursday", "this thursday", "next thursday", "next next friday"
  if (!date) {
    var resolved = resolveDayName(text);
    if (resolved) date = resolved;
  }

  // "next week" = next Monday
  if (!date && text === 'next week') {
    var todayDay = new Date(ty, tm-1, td).getDay();
    var diff = (8 - todayDay) % 7 || 7;
    var d4 = new Date(ty, tm-1, td + diff);
    date = fmtDate(d4);
  }

  // "5/6" or "5/6/2026" — M/D or M/D/YYYY format
  if (!date) {
    var slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (slashMatch) {
      var sMonth = parseInt(slashMatch[1]), sDay = parseInt(slashMatch[2]);
      var sYear = slashMatch[3] ? parseInt(slashMatch[3]) : ty;
      date = sYear + '-' + String(sMonth).padStart(2,'0') + '-' + String(sDay).padStart(2,'0');
    }
  }

  if (!date && !time) return null;
  if (!date) date = todayLocal;
  if (!time) time = defaultTime || '23:59';
  return { date: date, time: time };
}
function fmtDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

function parseFirstDay(text) {
  text = text.trim().toLowerCase();
  var todayStr = getTodayStr();
  var tParts = todayStr.split('-').map(Number);
  var ty = tParts[0], tm = tParts[1], td = tParts[2];
  var boundary = getForwardBoundary();
  var result = null;
  if (text === 'today') result = todayStr;
  else if (text === 'tomorrow') { var d = new Date(ty, tm-1, td+1); result = fmtDate(d); }
  else {
    // "5/5" or "5/5/2026"
    var slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (slashMatch) {
      var month = parseInt(slashMatch[1]), day = parseInt(slashMatch[2]);
      var year = slashMatch[3] ? parseInt(slashMatch[3]) : ty;
      result = year + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    }
  }
  // Day names with modifiers: "thursday", "next friday", "next next monday"
  if (!result) {
    var resolved = resolveDayName(text);
    if (resolved) result = resolved;
  }
  if (!result) return null;
  // Validate: not in past, not beyond boundary
  if (result < todayStr || result > boundary) return null;
  return result;
}
function parseTimeStr(s){s=s.trim().toLowerCase();let m=s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);if(m){let h=parseInt(m[1]);if(m[3]==='pm'&&h<12)h+=12;if(m[3]==='am'&&h===12)h=0;return String(h).padStart(2,'0')+':'+m[2];}m=s.match(/^(\d{1,2}):(\d{2})$/);if(m)return m[1].padStart(2,'0')+':'+m[2];m=s.match(/^(\d{1,2})\s*(am|pm)$/i);if(m){let h=parseInt(m[1]);if(m[2]==='pm'&&h<12)h+=12;if(m[2]==='am'&&h===12)h=0;return String(h).padStart(2,'0')+':00';}return null;}
function dateTimeToLocal(dateStr, timeStr) { return dateStr + 'T' + timeStr; }

/* ============================================================
   TIME EXPRESSION PREPROCESSOR
   Converts natural language time expressions to UTC ISO strings
   before sending to the LLM, saving tokens on simple calendar math.
   ============================================================ */

/**
 * Preprocess a user message, replacing recognized time expressions
 * with UTC ISO datetime strings. Returns the modified message.
 * Uses the user's timezone from prodUserTimezone global.
 */
function preprocessTimeExpressions(text) {
  var tz = (typeof prodUserTimezone !== 'undefined' && prodUserTimezone) || 'UTC';
  var now = new Date();

  // Build "today" in user's local perspective
  var todayLocal = localDate(now, tz);

  var replacements = [
    // "today" / "today at 3pm"
    { pattern: /\btoday(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/gi, fn: function(m, time) {
      if (time) return toUTCISO(todayLocal, parseTimeStr(time), tz);
      return '[today=' + todayLocal.toISOString().slice(0,10) + ']';
    }},
    // "tomorrow" / "tomorrow at 5pm"
    { pattern: /\btomorrow(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/gi, fn: function(m, time) {
      var d = addDays(todayLocal, 1);
      if (time) return toUTCISO(d, parseTimeStr(time), tz);
      return '[tomorrow=' + d.toISOString().slice(0,10) + ']';
    }},
    // "yesterday"
    { pattern: /\byesterday\b/gi, fn: function() {
      var d = addDays(todayLocal, -1);
      return '[yesterday=' + d.toISOString().slice(0,10) + ']';
    }},
    // "next Monday" / "next Tuesday" etc
    { pattern: /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/gi, fn: function(m, day, time) {
      var d = nextWeekday(todayLocal, dayNameToNum(day));
      if (time) return toUTCISO(d, parseTimeStr(time), tz);
      return '[next ' + day + '=' + d.toISOString().slice(0,10) + ']';
    }},
    // "this Monday" / "this Friday" etc
    { pattern: /\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/gi, fn: function(m, day, time) {
      var d = thisWeekday(todayLocal, dayNameToNum(day));
      if (time) return toUTCISO(d, parseTimeStr(time), tz);
      return '[this ' + day + '=' + d.toISOString().slice(0,10) + ']';
    }},
    // "in N hours"
    { pattern: /\bin\s+(\d+)\s+hours?\b/gi, fn: function(m, n) {
      var d = new Date(now.getTime() + parseInt(n) * 3600000);
      return d.toISOString();
    }},
    // "in N minutes"
    { pattern: /\bin\s+(\d+)\s+minutes?\b/gi, fn: function(m, n) {
      var d = new Date(now.getTime() + parseInt(n) * 60000);
      return d.toISOString();
    }},
    // "in N days"
    { pattern: /\bin\s+(\d+)\s+days?\b/gi, fn: function(m, n) {
      var d = addDays(todayLocal, parseInt(n));
      return '[in ' + n + ' days=' + d.toISOString().slice(0,10) + ']';
    }},
    // Standalone time: "at 3pm", "at 14:30", "at 9:00 am"
    { pattern: /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi, fn: function(m, time) {
      var parsed = parseTimeStr(time);
      if (parsed !== null) return '[at ' + formatTime24(parsed) + ']';
      return m;
    }},
  ];

  for (var i = 0; i < replacements.length; i++) {
    text = text.replace(replacements[i].pattern, replacements[i].fn);
  }
  return text;
}

// --- Helpers ---

function parseTimeStr(str) {
  // Parse "3pm", "3:30pm", "15:00", "9 am", "9:30 AM" → minutes since midnight
  if (!str) return null;
  str = str.trim().toLowerCase();
  var pm = str.indexOf('pm') >= 0;
  var am = str.indexOf('am') >= 0;
  str = str.replace(/[ap]m/i, '').trim();

  var parts = str.split(':');
  var h = parseInt(parts[0]);
  var m = parts.length > 1 ? parseInt(parts[1]) : 0;
  if (isNaN(h)) return null;

  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;

  return h * 60 + m;
}

function formatTime24(minutes) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function dayNameToNum(name) {
  var map = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
  return map[name.toLowerCase()] || 0;
}

function nextWeekday(fromDate, targetDay) {
  // Returns the NEXT occurrence of targetDay (0=Sun, 1=Mon, ...) after fromDate
  var d = new Date(fromDate);
  var current = d.getDay();
  var diff = targetDay - current;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function thisWeekday(fromDate, targetDay) {
  // Returns the occurrence of targetDay in the current week
  var d = new Date(fromDate);
  var current = d.getDay();
  var diff = targetDay - current;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, n) {
  var d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function localDate(date, tz) {
  // Get "today" as a Date object in the user's timezone
  try {
    var str = date.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    return new Date(str + 'T00:00:00');
  } catch (e) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
}

function toUTCISO(dateObj, minutesSinceMidnight, tz) {
  // Combine a date + time-of-day → UTC ISO string
  if (minutesSinceMidnight === null) return dateObj.toISOString().slice(0,10);
  var h = Math.floor(minutesSinceMidnight / 60);
  var m = minutesSinceMidnight % 60;
  // Create a date string in the user's timezone, then convert to UTC
  var localStr = dateObj.toISOString().slice(0,10) + 'T' + formatTime24(minutesSinceMidnight) + ':00';
  try {
    // Use Intl to figure out the offset
    var testDate = new Date(localStr + 'Z');
    var formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false, timeZoneName: 'shortOffset' });
    // Approximate: just return the local string with a note for the LLM
    return localStr + ' [' + tz + ']';
  } catch (e) {
    return localStr + 'Z';
  }
}

// --- Smart Input Modal ---
let smartIsRoutine = false;
let draftAutoSaveTimer = null;

function openSmartModal(isRoutine, editTask = null) {
  smartIsRoutine = isRoutine;
  const modal = document.getElementById('prod-smart-modal');
  document.getElementById('smart-modal-title').textContent = editTask ? 'Edit Task' : (isRoutine ? 'New Routine' : 'New Task');
  document.getElementById('sm-editing-id').value = editTask ? (editTask.task_id || '') : '';
  document.getElementById('sm-input').value = '';

  document.getElementById('sm-assign').value = editTask && editTask.assign_datetime ? toLocalDatetimeValue(editTask.assign_datetime) : '';
  // Swap due input type: time-only for routine, full datetime for task
  var dueInput = document.getElementById('sm-due');
  var dueLabel = document.getElementById('sm-due-label');
  if (isRoutine) {
    dueInput.type = 'time';
    dueInput.value = '';
    if (dueLabel) dueLabel.textContent = 'Due time';
  } else {
    dueInput.type = 'datetime-local';
    dueInput.value = editTask && editTask.due_datetime ? toLocalDatetimeValue(editTask.due_datetime) : '';
    if (dueLabel) dueLabel.textContent = 'Due';
  }
  document.getElementById('sm-name').value = editTask ? (editTask.name||'') : '';
  document.getElementById('sm-pattern').value = '';
  document.getElementById('sm-pattern-value').value = '';
  document.getElementById('sm-pattern-day-picker').style.display = 'none';
  document.getElementById('sm-pattern-interval-input').style.display = 'none';
  // Reset day toggle buttons
  var dayToggles = document.querySelectorAll('.sm-day-toggle');
  for (var dti = 0; dti < dayToggles.length; dti++) {
    dayToggles[dti].classList.remove('primary');
    dayToggles[dti].classList.add('secondary');
  }
  document.getElementById('sm-interval-n').value = 2;

  // Instances start disabled when no pattern
  document.getElementById('sm-max-instances').disabled = true;
  document.getElementById('sm-max-instances').value = '';

  // Show/hide routine vs task fields
  document.getElementById('sm-routine-row').style.display = isRoutine ? 'flex' : 'none';
  document.getElementById('sm-pattern-hint').style.display = isRoutine ? 'inline' : 'none';
  document.getElementById('sm-assign-time-wrap').style.display = isRoutine ? 'block' : 'none';
  document.getElementById('sm-assign-wrap').style.display = isRoutine ? 'none' : 'block';

  // Set first_day bounds
  var todayStr = getTodayStr();
  var boundary = getForwardBoundary();
  var firstDayInput = document.getElementById('sm-first-day');
  firstDayInput.min = todayStr;
  firstDayInput.max = boundary;
  firstDayInput.value = todayStr;
  firstDayInput.onchange = function() { autoComputeMaxIfReady(); };

  // Default assign time
  document.getElementById('sm-assign-time').value = '07:00';

  // Pattern dropdown change handler
  document.getElementById('sm-pattern').onchange = function() {
    var sel = this.value;
    var dayPicker = document.getElementById('sm-pattern-day-picker');
    var intervalInput = document.getElementById('sm-pattern-interval-input');
    var hiddenVal = document.getElementById('sm-pattern-value');
    var instancesInput = document.getElementById('sm-max-instances');

    dayPicker.style.display = 'none';
    intervalInput.style.display = 'none';

    if (sel === 'custom-set') {
      dayPicker.style.display = 'block';
      // Build pattern from currently toggled buttons
      updateDayPickerPattern();
    } else if (sel === 'custom-interval') {
      intervalInput.style.display = 'block';
      updateIntervalPattern();
    } else if (sel === '') {
      hiddenVal.value = '';
      instancesInput.disabled = true;
      instancesInput.value = '';
    } else {
      hiddenVal.value = sel;
      instancesInput.disabled = false;
      autoComputeMaxIfReady();
    }
  };

  // Restore saved fields from editTask (draft resume or edit)
  if (editTask && isRoutine) {
    if (editTask.assign_time) document.getElementById('sm-assign-time').value = editTask.assign_time;
    if (editTask.due_time) { document.getElementById('sm-due').value = editTask.due_time; }
    if (editTask.first_day) document.getElementById('sm-first-day').value = editTask.first_day;
    if (editTask.pattern) setPatternInModal(editTask.pattern);
    if (editTask.max_instances) {
      document.getElementById('sm-max-instances').value = editTask.max_instances;
      document.getElementById('sm-max-instances').disabled = false;
    }
  }

  if (!editTask) {
    var draftId = crypto.randomUUID ? crypto.randomUUID() : 'draft-' + Date.now();
    document.getElementById('sm-draft-id').value = draftId;
    fetch('/api/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft_id:draftId,name:'',is_routine_draft:isRoutine})});
  } else {
    document.getElementById('sm-draft-id').value = editTask && editTask.draft_id ? editTask.draft_id : '';
  }
  modal.classList.add('open');
  document.getElementById('sm-input').focus();
}

function closeSmartModal() { document.getElementById('prod-smart-modal').classList.remove('open'); if(draftAutoSaveTimer){clearTimeout(draftAutoSaveTimer);draftAutoSaveTimer=null;} }
function dismissSmartModal() {
  // If form is blank, delete the draft instead of keeping it
  var draftId = document.getElementById('sm-draft-id').value;
  var hasContent = document.getElementById('sm-name').value.trim() ||
    document.getElementById('sm-input').value.trim();
  if (!hasContent && draftId) {
    fetch('/api/drafts/' + draftId, { method: 'DELETE' });
  }
  closeSmartModal();
  loadProductivityData();
}
function openEditFromCard(taskId) { closeProdDropdowns(); const t=prodAllTasks.find(x=>x.task_id===taskId); if(!t)return; openSmartModal(!!t.routine_id,t); }
function resumeDraft(draftId) {
  fetch('/api/drafts').then(r=>r.json()).then(all=>{
    const draft=all.find(t=>t.draft_id===draftId);
    if(!draft)return;
    if(draft.draft_type==='note') {
      var noteData = {name: draft.name||'', date: draft.date||null, folder_id: draft.folder_id||null, _draftId: draft.draft_id};
      openNoteAdd(noteData);
    } else if(draft.draft_type==='folder') {
      var folderData = {name: draft.name || '', parent_id: draft.parent_id || null, color: draft.color||DEFAULT_COLOR, _draftId: draft.draft_id};
      openFolderModal(folderData);
    } else {
      openSmartModal(!!draft.is_routine_draft,draft);
    }
  });
}
function deleteDraft(draftId) { fetch('/api/drafts/'+draftId,{method:'DELETE'}).then(()=>loadProductivityData()); }

function scheduleDraftSave() { if(draftAutoSaveTimer)clearTimeout(draftAutoSaveTimer); draftAutoSaveTimer=setTimeout(saveDraft,2000); }
function saveDraft() {
  const editId=document.getElementById('sm-editing-id').value;
  if(editId&&!document.getElementById('sm-draft-id').value)return;
  const draftId=document.getElementById('sm-draft-id').value;if(!draftId)return;
  const name=document.getElementById('sm-name').value.trim()||document.getElementById('sm-input').value.trim();
  const data={name:name||'',is_routine_draft:smartIsRoutine};
  if(smartIsRoutine){
    data.pattern=document.getElementById('sm-pattern-value').value||null;
    data.due_time=document.getElementById('sm-due').value||null;
    data.assign_time=document.getElementById('sm-assign-time').value||null;
    data.first_day=document.getElementById('sm-first-day').value||null;
    var miVal=document.getElementById('sm-max-instances').value;
    if(miVal)data.max_instances=parseInt(miVal);
  }
  else{data.assign_datetime=localInputToUTC(document.getElementById('sm-assign').value);data.due_datetime=localInputToUTC(document.getElementById('sm-due').value);}
  fetch('/api/drafts/'+draftId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}

document.addEventListener('input', function(e) { if(['sm-name','sm-input','sm-assign','sm-due','sm-pattern','sm-assign-time','sm-first-day','sm-max-instances','sm-pattern-value','sm-interval-n'].includes(e.target.id)) scheduleDraftSave(); });

// Live parsing
document.addEventListener('keyup', function(e) {
  if(e.target.id!=='sm-input')return;
  const input=e.target;const val=input.value;
  // Name in single quotes: require closing quote + comma so apostrophes don't cut off early
  // e.g. "shave my cat's hair," captures the full name
  const sqMatch=val.match(/^(.*?)'(.+)',(.*)$/);
  if(sqMatch){document.getElementById('sm-name').value=sqMatch[2].trim();input.value=(sqMatch[1]+sqMatch[3]).replace(/^[\s,]+|[\s,]+$/g,'');scheduleDraftSave();return;}
  if(!val.includes(','))return;
  const parts=val.split(',');const last=parts.pop();let consumed=false;
  for(const raw of parts){const seg=raw.trim().toLowerCase();if(!seg)continue;
    // For routines: parse "assign HH:MM am/pm" or "assign HH:MM"
    if(smartIsRoutine){
      const assignTimeMatch=seg.match(/^assign\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})$/i);
      if(assignTimeMatch){const t=parseTimeStr(assignTimeMatch[1]);if(t){document.getElementById('sm-assign-time').value=t;consumed=true;continue;}}
      const dueTimeMatch=seg.match(/^due\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})$/i);
      if(dueTimeMatch){const t=parseTimeStr(dueTimeMatch[1]);if(t){document.getElementById('sm-due').value=t;consumed=true;continue;}}
      // "first today", "first tomorrow", "first 5/5", "first 5/5/2026", "first thursday"
      var firstMatch=seg.match(/^first\s+(.+)$/);
      if(firstMatch){
        var fd=parseFirstDay(firstMatch[1].trim());
        if(fd){
          // Immediately push for set patterns before setting the field
          var curPattern=document.getElementById('sm-pattern-value').value;
          if(curPattern && curPattern.startsWith('set:')) fd=adjustFirstDayForPattern(fd,curPattern);
          document.getElementById('sm-first-day').value=fd;
          consumed=true;continue;
        }
      }
      // "N times" or "n times" or "5 times"
      const timesMatch=seg.match(/^(\d+|n)\s+times?$/i);
      if(timesMatch){
        var tmPatVal=document.getElementById('sm-pattern-value').value;
        if(!tmPatVal){continue;} // skip if no pattern set
        var tmFirstDay=document.getElementById('sm-first-day').value;
        var tmMaxPossible=(tmFirstDay&&tmPatVal)?computeMaxInstancesClientSide(tmFirstDay,tmPatVal):999;
        var tmVal;
        if(timesMatch[1].toLowerCase()==='n'){
          tmVal=tmMaxPossible;
        } else {
          tmVal=parseInt(timesMatch[1]);
          if(tmVal<2)tmVal=2;
          if(tmVal>tmMaxPossible)tmVal=tmMaxPossible;
        }
        document.getElementById('sm-max-instances').value=tmVal;
        consumed=true;continue;
      }
    }
    // For one-off: assign/due with full datetime
    if(!smartIsRoutine){
      const am=seg.match(/^assign\s+(.+)$/);if(am){const p=parseNaturalDate(am[1],'00:00');if(p){document.getElementById('sm-assign').value=dateTimeToLocal(p.date,p.time);consumed=true;continue;}}
      const dm=seg.match(/^due\s+(.+)$/);if(dm){const p=parseNaturalDate(dm[1],'23:59');if(p){document.getElementById('sm-due').value=dateTimeToLocal(p.date,p.time);consumed=true;continue;}}
    }
    // Pattern parsing for routines using parsePatternInput
    if(smartIsRoutine){
      var parsedPat=parsePatternInput(seg);
      if(parsedPat){setPatternInModal(parsedPat);consumed=true;continue;}
    }
  }
  if(consumed){input.value=last.trimStart();scheduleDraftSave();}
});


function saveSmartTask() {
  const editId=document.getElementById('sm-editing-id').value;
  const draftId=document.getElementById('sm-draft-id').value;
  const name=document.getElementById('sm-name').value.trim()||document.getElementById('sm-input').value.trim();
  if(!name){alert('Task name is required.');document.getElementById('sm-name').focus();return;}
  const dueVal=document.getElementById('sm-due').value;
  const assignVal=document.getElementById('sm-assign').value;
  if(smartIsRoutine){
    var assignTimeVal=document.getElementById('sm-assign-time').value;
    if(!assignTimeVal){alert('Assign time is required for routines.');document.getElementById('sm-assign-time').focus();return;}
    if(!dueVal){alert('Due time is required for routines.');document.getElementById('sm-due').focus();return;}
    var firstDayVal=document.getElementById('sm-first-day').value;
    if(!firstDayVal){alert('First day is required for routines.');document.getElementById('sm-first-day').focus();return;}
    var patternVal=document.getElementById('sm-pattern-value').value;
    if(!patternVal){alert('Please select a pattern.');return;}
    var maxInstancesVal=parseInt(document.getElementById('sm-max-instances').value)||85;
    // Auto-adjust first_day for day-of-week patterns
    firstDayVal=adjustFirstDayForPattern(firstDayVal,patternVal);
    document.getElementById('sm-first-day').value=firstDayVal;
    const data={name,assign_time:assignTimeVal,due_time:dueVal,first_day:firstDayVal,pattern:patternVal,max_instances:maxInstancesVal};
    // editId is only valid for editing existing S3 templates (set by editRoutine).
    // Drafts resumed from DynamoDB should POST (create new), not PUT.
    var isEditingTemplate = editId && !draftId;
    const url=isEditingTemplate?'/api/routines/'+editId:'/api/routines';
    const method=isEditingTemplate?'PUT':'POST';
    fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error('HTTP '+r.status+': '+t);});return r.json();}).then(function(){closeSmartModal();if(draftId)fetch('/api/drafts/'+draftId,{method:'DELETE'});fetch('/api/routines/materialize',{method:'POST'}).then(function(){loadProductivityData();});}).catch(function(err){console.error('Save routine failed:',err);alert('Failed: '+(err.message||err));});
  } else {
    if(!assignVal){alert('Assign date is required.');document.getElementById('sm-assign').focus();return;}
    if(!dueVal){alert('Due date is required.');document.getElementById('sm-due').focus();return;}
    const data={name,assign_datetime:localInputToUTC(assignVal),due_datetime:localInputToUTC(dueVal),path:'/'};
    if(editId){
      fetch('/api/tasks/'+editId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>{if(!r.ok)throw 0;return r.json();}).then(()=>{closeSmartModal();loadProductivityData();}).catch(()=>alert('Failed.'));
    } else {
      fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>{if(!r.ok)throw 0;return r.json();}).then(()=>{closeSmartModal();if(draftId)fetch('/api/drafts/'+draftId,{method:'DELETE'});loadProductivityData();}).catch(()=>alert('Failed.'));
    }
  }
}

// --- Snooze/Reschedule ---
function openSnoozeTask(taskId) { closeProdDropdowns();const t=prodAllTasks.find(x=>x.task_id===taskId);if(!t)return;document.getElementById('psm-id').value=taskId;document.getElementById('psm-name-display').textContent=t.name;document.getElementById('psm-assign').value=t.assign_datetime?toLocalDatetimeValue(t.assign_datetime):'';document.getElementById('psm-due').value=t.due_datetime?toLocalDatetimeValue(t.due_datetime):'';document.getElementById('prod-snooze-modal').classList.add('open'); }
function closeSnoozeModal() { document.getElementById('prod-snooze-modal').classList.remove('open'); }
function saveSnooze() { const taskId=document.getElementById('psm-id').value;const data={assign_datetime:localInputToUTC(document.getElementById('psm-assign').value),due_datetime:localInputToUTC(document.getElementById('psm-due').value),due_status:'pending'};fetch('/api/tasks/'+taskId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>{if(!r.ok)throw 0;return r.json();}).then(()=>{closeSnoozeModal();loadProductivityData();}).catch(()=>alert('Failed.')); }

// --- Goals & Data Collection ---
// loadGoalsData — kept for backward compat from goal save/delete actions
function loadGoalsData() { refreshData(); }

function openGoalModal(editName) {
  document.getElementById('gm-editing').value=editName||'';document.getElementById('gm-name').value=editName||'';document.getElementById('gm-display').value='';document.getElementById('gm-unit').value='';
  if(editName){document.getElementById('goal-modal-title').textContent='Edit Goal';fetch('/api/goals').then(r=>r.json()).then(goals=>{const g=goals.find(x=>x.name===editName);if(g){document.getElementById('gm-display').value=g.display_name||'';document.getElementById('gm-unit').value=g.unit||'';}});}
  else{document.getElementById('goal-modal-title').textContent='New Goal';}
  document.getElementById('prod-goal-modal').classList.add('open');document.getElementById('gm-name').focus();
}
function closeGoalModal(){document.getElementById('prod-goal-modal').classList.remove('open');}
function saveGoal(){
  const name=document.getElementById('gm-name').value.trim();if(!name){alert('Goal name is required.');return;}
  const display=document.getElementById('gm-display').value.trim()||name;const unit=document.getElementById('gm-unit').value.trim();
  const editing=document.getElementById('gm-editing').value;const url=editing?'/api/goals/'+encodeURIComponent(editing):'/api/goals';const method=editing?'PUT':'POST';
  const data={name:name.toLowerCase().replace(/\s+/g,'_'),display_name:display,unit,fields:[{name:'value',type:'number',unit}]};
  fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>{if(!r.ok)throw 0;return r.json();}).then(()=>{closeGoalModal();loadGoalsData();}).catch(()=>alert('Failed.'));
}
function deleteGoal(name){if(!confirm('Delete goal "'+name+'"?'))return;fetch('/api/goals/'+encodeURIComponent(name),{method:'DELETE'}).then(()=>loadGoalsData()).catch(()=>alert('Failed.'));}

function openLogModal(goalName){
  document.getElementById('lm-goal').value=goalName;document.getElementById('lm-date').value=getTodayStr();document.getElementById('lm-value').value='';
  document.getElementById('prod-log-modal').classList.add('open');
  fetch('/api/goals').then(r=>r.json()).then(goals=>{const g=goals.find(x=>x.name===goalName);const dn=g?(g.display_name||g.name):goalName;const unit=g?(g.unit||''):'';document.getElementById('log-modal-title').textContent='Log: '+dn;document.getElementById('lm-value-label').textContent='Value'+(unit?` (${unit})`:'');document.getElementById('lm-unit').value=unit;});
  document.getElementById('lm-value').focus();
}
function closeLogModal(){document.getElementById('prod-log-modal').classList.remove('open');}
function saveLogEntry(){
  const goalName=document.getElementById('lm-goal').value;const date=document.getElementById('lm-date').value;if(!date){alert('Date is required.');return;}
  const val=document.getElementById('lm-value').value.trim();if(!val){alert('Value is required.');document.getElementById('lm-value').focus();return;}
  fetch('/api/goals/'+encodeURIComponent(goalName)+'/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,entry:{value:parseFloat(val)}})}).then(r=>{if(!r.ok)throw 0;return r.json();}).then(()=>{closeLogModal();alert('Data logged!');}).catch(()=>alert('Failed.'));
}

// --- Goal Chart ---
function viewGoalChart(goalName) {
  const area=document.getElementById('content-area');if(!area)return;
  area.innerHTML='<p class="loading">Loading chart data...</p>';
  Promise.all([fetch('/api/goals').then(r=>r.json()),fetch('/api/goals/'+encodeURIComponent(goalName)+'/data').then(r=>r.json())]).then(([goals,dateResp])=>{
    const goal=goals.find(g=>g.name===goalName);const displayName=goal?(goal.display_name||goal.name):goalName;const unit=goal?(goal.unit||''):'';const dates=dateResp.dates||[];
    if(dates.length===0){area.innerHTML=`<div class="productivity-container"><div class="prod-toolbar"><h2>${escHtml(displayName)}</h2><button class="prod-add-btn secondary" onclick="loadProductivityData()"><span class="material-symbols-outlined">arrow_back</span> Back</button></div><p class="prod-empty">No data logged yet.</p></div>`;return;}
    const recentDates=dates.slice(0,90);
    Promise.all(recentDates.map(d=>fetch('/api/goals/'+encodeURIComponent(goalName)+'/data?date='+d).then(r=>r.json()).then(data=>({date:d,data})))).then(results=>{
      const dailyData=results.map(r=>{const entries=r.data.entries||[];const values=entries.map(e=>e.value).filter(v=>typeof v==='number');const avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;return{date:r.date,value:avg};}).filter(d=>d.value!==null).sort((a,b)=>a.date.localeCompare(b.date));
      renderGoalChart(area,displayName,unit,goalName,dailyData);
    });
  }).catch(()=>{area.innerHTML='<p style="color:#d93025">Failed to load goal data.</p>';});
}

function renderGoalChart(area,displayName,unit,goalName,dailyData) {
  if(dailyData.length===0){area.innerHTML=`<div class="productivity-container"><div class="prod-toolbar"><h2>${escHtml(displayName)}</h2><button class="prod-add-btn secondary" onclick="loadProductivityData()"><span class="material-symbols-outlined">arrow_back</span> Back</button></div><p class="prod-empty">No numerical data logged yet.</p></div>`;return;}
  const values=dailyData.map(d=>d.value);const maxVal=Math.max(...values);const minVal=Math.min(...values);const avgVal=values.reduce((a,b)=>a+b,0)/values.length;const range=maxVal-minVal||1;
  const chartW=800,chartH=300,padL=60,padR=20,padT=20,padB=50;const plotW=chartW-padL-padR;const plotH=chartH-padT-padB;const n=dailyData.length;
  let pathD='';let dots='';
  const points=dailyData.map((d,i)=>{const x=padL+(n===1?plotW/2:(i/(n-1))*plotW);const y=padT+plotH-((d.value-minVal)/range)*plotH;return{x,y,date:d.date,value:d.value};});
  points.forEach((p,i)=>{pathD+=(i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);dots+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#1a73e8" stroke="#fff" stroke-width="1.5"><title>${p.date}: ${p.value} ${escHtml(unit)}</title></circle>`;});
  let yLabels='';for(let i=0;i<=4;i++){const val=minVal+(range*i/4);const y=padT+plotH-(i/4)*plotH;yLabels+=`<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="10" fill="#80868b">${val.toFixed(val%1?1:0)}</text>`;yLabels+=`<line x1="${padL}" x2="${chartW-padR}" y1="${y}" y2="${y}" stroke="#f1f3f4" stroke-width="1"/>`;}
  let xLabels='';const labelCount=Math.min(8,n);for(let i=0;i<labelCount;i++){const idx=Math.round(i*(n-1)/(labelCount-1||1));const p=points[idx];xLabels+=`<text x="${p.x}" y="${chartH-8}" text-anchor="middle" font-size="9" fill="#80868b">${p.date.slice(5)}</text>`;}
  const statsHtml=`<div style="display:flex;gap:24px;margin-top:12px;font-size:0.85rem;color:#5f6368"><span><b>Min:</b> ${minVal.toFixed(1)} ${escHtml(unit)}</span><span><b>Max:</b> ${maxVal.toFixed(1)} ${escHtml(unit)}</span><span><b>Avg:</b> ${avgVal.toFixed(1)} ${escHtml(unit)}</span><span><b>Days:</b> ${n}</span></div>`;
  area.innerHTML=`<div class="productivity-container"><div class="prod-toolbar"><h2>${escHtml(displayName)}</h2><div class="prod-toolbar-btns"><button class="prod-add-btn secondary" onclick="openLogModal('${escHtml(goalName)}')"><span class="material-symbols-outlined">add</span> Log</button><button class="prod-add-btn secondary" onclick="loadProductivityData()"><span class="material-symbols-outlined">arrow_back</span> Back</button></div></div><div class="prod-section"><div class="prod-section-header"><span class="material-symbols-outlined">show_chart</span> ${escHtml(displayName)} over time${unit?' ('+escHtml(unit)+')':''}</div><div class="prod-section-body" style="overflow-x:auto"><svg width="${chartW}" height="${chartH}" style="display:block;max-width:100%">${yLabels}<path d="${pathD}" fill="none" stroke="#1a73e8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}${xLabels}<line x1="${padL}" x2="${chartW-padR}" y1="${padT+plotH}" y2="${padT+plotH}" stroke="#dadce0" stroke-width="1"/><line x1="${padL}" x2="${padL}" y1="${padT}" y2="${padT+plotH}" stroke="#dadce0" stroke-width="1"/></svg>${statsHtml}</div></div><div class="prod-section"><div class="prod-section-header"><span class="material-symbols-outlined">table_view</span> Recent Entries</div><div class="prod-section-body"><table class="users-table" style="font-size:0.85rem"><thead><tr><th>Date</th><th>Value${unit?' ('+escHtml(unit)+')':''}</th></tr></thead><tbody>${dailyData.slice().reverse().slice(0,30).map(d=>`<tr><td>${d.date}</td><td>${d.value}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

// --- Calendar ---
function initWeekStart() {
  const todayParts=getTodayStr().split('-').map(Number);const d=new Date(todayParts[0],todayParts[1]-1,todayParts[2]);const day=d.getDay();weekCalStart=new Date(d);weekCalStart.setDate(weekCalStart.getDate()-day);
}

function loadCalendar() {
  fetch('/api/tasks/calendar?month='+prodCalendarMonth).then(function(r){return r.json();}).then(function(data) {
    prodCalendarData = data;
    renderCalendarFromCache();
  }).catch(function(){});
}

function renderCalendar(el, monthData) {
  if(!weekCalStart)initWeekStart();
  var root = document.getElementById('monthly-root');
  if (!root) return;

  const [year,month] = prodCalendarMonth.split('-').map(Number);
  const firstDay = new Date(year, month-1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = getTodayStr();
  const totalCells = firstDay + daysInMonth;
  const numRows = Math.ceil(totalCells / 7);

  // Compute row height to fill viewport
  var headerH = 32; // approximate header row height
  var availH = window.innerHeight - headerH;
  var rowH = availH / numRows;

  var html = '<div class="mo-grid" style="grid-template-rows:auto repeat(' + numRows + ',1fr)">';

  // Header row
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d) {
    html += '<div class="mo-day-hdr">' + d + '</div>';
  });

  // Helper: get tasks completed on a given date from cached data
  function getTasksForDate(dateStr) {
    // First check monthData (from calendar API)
    if (monthData[dateStr]) return monthData[dateStr];
    // Fallback: search prodAllTasks for tasks completed on this date
    var results = [];
    (prodAllTasks || []).forEach(function(t) {
      if (!t.end_datetime || t.draft) return;
      if (utcToLocalDate(t.end_datetime) === dateStr) {
        results.push({task_id: t.task_id, name: t.name, end_datetime: t.end_datetime, folder_id: t.folder_id});
      }
    });
    return results;
  }

  // Leading cells from previous month (greyed out but with content)
  var prevMonthDays = new Date(year, month-1, 0).getDate(); // last day of prev month
  for (var i = 0; i < firstDay; i++) {
    var prevD = prevMonthDays - firstDay + 1 + i;
    var prevM = month - 1; var prevY = year;
    if (prevM < 1) { prevM = 12; prevY--; }
    var prevDateStr = prevY + '-' + String(prevM).padStart(2,'0') + '-' + String(prevD).padStart(2,'0');
    var prevTasks = getTasksForDate(prevDateStr);
    var prevNotes = getNotesForDate(prevDateStr);
    var prevPlanned = getPlannedForDate(prevDateStr);
    html += '<div class="mo-cell mo-empty" ondblclick="goToWeekOf(\'' + prevDateStr + '\')">';
    html += '<div class="mo-day-num">' + prevD + '</div>';
    html += '<div class="mo-day-tasks">';
    for (var pi = 0; pi < prevTasks.length; pi++) {
      var ptColor = getFolderColor(prevTasks[pi].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-note" style="background:' + escHtml(ptColor) + '">' + escHtml(prevTasks[pi].name) + '</div>';
    }
    for (var pni = 0; pni < prevNotes.length; pni++) {
      var pnColor = getFolderColor(prevNotes[pni].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-note" style="background:' + escHtml(pnColor) + '">' + escHtml(prevNotes[pni].name) + '</div>';
    }
    for (var ppi = 0; ppi < prevPlanned.length; ppi++) {
      var ppColor = getFolderColor(prevPlanned[ppi].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-planned" style="border-color:' + escHtml(ppColor) + ';color:' + escHtml(ppColor) + '">' + escHtml(prevPlanned[ppi].name) + '</div>';
    }
    html += '</div></div>';
  }

  // Helper: get notes for a given date
  function getNotesForDate(dateStr) {
    if (!monthlyShowNotes) return [];
    return (prodNotes || []).filter(function(n) { return n.date === dateStr; });
  }

  // Helper: get planned (incomplete, non-overdue) tasks due on a given date
  function getPlannedForDate(dateStr) {
    if (!monthlyShowPlanned) return [];
    var todayStr2 = getTodayStr();
    return (prodAllTasks || []).filter(function(t) {
      if (t.draft || t.end_datetime) return false; // skip drafts and completed
      if (!t.due_datetime) return false;
      var dueDate = utcToLocalDate(t.due_datetime);
      if (dueDate < todayStr2) return false; // skip overdue
      return dueDate === dateStr;
    });
  }

  // Day cells for current month
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var dayTasks = monthData[dateStr] || [];
    var dayNotes = getNotesForDate(dateStr);
    var dayPlanned = getPlannedForDate(dateStr);
    var cls = dateStr === todayStr ? ' mo-today' : '';
    html += '<div class="mo-cell' + cls + '" ondblclick="goToWeekOf(\'' + dateStr + '\')">';
    html += '<div class="mo-day-num">' + d + '</div>';
    html += '<div class="mo-day-tasks">';
    for (var ti = 0; ti < dayTasks.length; ti++) {
      var tColor = getFolderColor(dayTasks[ti].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-note" style="background:' + escHtml(tColor) + '">' + escHtml(dayTasks[ti].name) + '</div>';
    }
    for (var ni = 0; ni < dayNotes.length; ni++) {
      var nColor = getFolderColor(dayNotes[ni].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-note" style="background:' + escHtml(nColor) + '">' + escHtml(dayNotes[ni].name) + '</div>';
    }
    for (var pli = 0; pli < dayPlanned.length; pli++) {
      var plColor = getFolderColor(dayPlanned[pli].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-planned" style="border-color:' + escHtml(plColor) + ';color:' + escHtml(plColor) + '">' + escHtml(dayPlanned[pli].name) + '</div>';
    }
    html += '</div></div>';
  }

  // Trailing cells from next month (greyed out but with content)
  var rem = (7 - (totalCells % 7)) % 7;
  for (var j = 0; j < rem; j++) {
    var nextD = j + 1;
    var nextM = month + 1; var nextY = year;
    if (nextM > 12) { nextM = 1; nextY++; }
    var nextDateStr = nextY + '-' + String(nextM).padStart(2,'0') + '-' + String(nextD).padStart(2,'0');
    var nextTasks = getTasksForDate(nextDateStr);
    var nextNotes = getNotesForDate(nextDateStr);
    var nextPlanned = getPlannedForDate(nextDateStr);
    html += '<div class="mo-cell mo-empty" ondblclick="goToWeekOf(\'' + nextDateStr + '\')">';
    html += '<div class="mo-day-num">' + nextD + '</div>';
    html += '<div class="mo-day-tasks">';
    for (var tni = 0; tni < nextTasks.length; tni++) {
      var ntColor = getFolderColor(nextTasks[tni].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-note" style="background:' + escHtml(ntColor) + '">' + escHtml(nextTasks[tni].name) + '</div>';
    }
    for (var nni = 0; nni < nextNotes.length; nni++) {
      var nnColor = getFolderColor(nextNotes[nni].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-note" style="background:' + escHtml(nnColor) + '">' + escHtml(nextNotes[nni].name) + '</div>';
    }
    for (var npli = 0; npli < nextPlanned.length; npli++) {
      var nplColor = getFolderColor(nextPlanned[npli].folder_id) || DEFAULT_COLOR;
      html += '<div class="mo-day-task mo-day-planned" style="border-color:' + escHtml(nplColor) + ';color:' + escHtml(nplColor) + '">' + escHtml(nextPlanned[npli].name) + '</div>';
    }
    html += '</div></div>';
  }

  html += '</div>';
  root.innerHTML = html;

  // Post-render: detect overflow in each cell and add "+N more" indicator
  requestAnimationFrame(function() {
    var containers = root.querySelectorAll('.mo-day-tasks');
    containers.forEach(function(cont) {
      var tasks = cont.querySelectorAll('.mo-day-task');
      if (tasks.length === 0) return;
      if (cont.scrollHeight <= cont.clientHeight) return;
      // Find how many tasks are visible
      var contRect = cont.getBoundingClientRect();
      var hiddenCount = 0;
      // Reserve space for the "+more" label (~14px)
      var moreHeight = 14;
      for (var k = tasks.length - 1; k >= 0; k--) {
        var taskRect = tasks[k].getBoundingClientRect();
        if (taskRect.bottom > contRect.bottom - moreHeight) {
          tasks[k].style.display = 'none';
          hiddenCount++;
        } else {
          break;
        }
      }
      if (hiddenCount > 0) {
        var more = document.createElement('div');
        more.className = 'mo-day-task mo-more';
        more.textContent = '+' + hiddenCount + ' more';
        cont.appendChild(more);
      }
    });
  });
}

function changeCalendarMonth(delta) {
  const[y,m]=prodCalendarMonth.split('-').map(Number);
  const d=new Date(y,m-1+delta,1);
  const newMonth = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  // Enforce boundaries: creation year Jan through next year Dec
  if (accessibleStartDate && newMonth < accessibleStartDate.slice(0,7)) return;
  if (accessibleEndDate && newMonth > accessibleEndDate.slice(0,7)) return;
  prodCalendarMonth=newMonth;
  loadCalendar();
  updateMonthlySubtab();
}
function toggleWeekView(){showWeekView=!showWeekView;loadCalendar();}

function renderWeekView() {
  if (!weekCalStart) initWeekStart();
  var TICK_MARGIN = 8; // px reserved above first and below last tick label
  var totalIntervals = Math.round(24 / weekIntervalHrs);
  var hdrEl = document.getElementById('weekly-header');
  var headerH = hdrEl ? hdrEl.offsetHeight : 39;
  var availH = window.innerHeight - headerH;
  var cellH = (availH - 2 * TICK_MARGIN) / weekVisibleCells;
  var HOUR_PX = cellH / weekIntervalHrs;
  var TOTAL_H = totalIntervals * cellH + 2 * TICK_MARGIN;
  const MIN_CARD_MINUTES = 10;
  const todayStr = getTodayStr();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(weekCalStart); d.setDate(d.getDate() + i); days.push(fmtDate(d)); }

  // Build sessions from TimeLogs table
  const weekLogs = (prodTimelogs || []).filter(l => l.parent_type === 'task' && l.start && days.includes(utcToLocalDate(l.start)));
  const sessions = [];
  // Group logs by parent_id to count total sessions per task
  const logsByTask = {};
  weekLogs.forEach(l => { if (!logsByTask[l.parent_id]) logsByTask[l.parent_id] = []; logsByTask[l.parent_id].push(l); });
  Object.keys(logsByTask).forEach(taskId => {
    const t = (prodAllTasks || []).find(x => x.task_id === taskId);
    if (!t || t.draft) return;
    const logs = logsByTask[taskId];
    const totalSessions = logs.length;
    logs.forEach((s, idx) => {
      const dayStr = utcToLocalDate(s.start);
      if (!days.includes(dayStr)) return;
      const startFrac = getLocalHourFrac(s.start);
      const endIso = s.end || t.end_datetime;
      let endFrac = endIso ? getLocalHourFrac(endIso) : startFrac + 0.25;
      if (endFrac <= startFrac) endFrac = startFrac + (1/60);
      const durationMin = (endFrac - startFrac) * 60;
      sessions.push({ taskId: t.task_id, taskName: t.name, path: t.path || '/', dayStr, startFrac, endFrac, durationMin, sessionIndex: idx + 1, totalSessions, color: getFolderColor(t.folder_id) });
    });
  });

  // Due cards: non-completed tasks whose due_datetime is on a visible day and not yet passed
  var nowIso = new Date().toISOString();
  var dueTasks = (prodAllTasks || []).filter(function(t) {
    if (t.draft || t.end_datetime) return false;
    if (!t.due_datetime) return false;
    if (t.due_datetime < nowIso) return false;
    var dueDay = utcToLocalDate(t.due_datetime);
    return days.indexOf(dueDay) >= 0;
  });

  // Action cards: filter actions whose start_datetime falls on a visible day
  var weekActions = (prodActions || []).filter(function(a) {
    if (!a.start_datetime) return false;
    var startDay = utcToLocalDate(a.start_datetime);
    return days.indexOf(startDay) >= 0;
  });

  var root = document.getElementById('weekly-root');
  if (!root) return;

  // Build as a CSS grid: 8 columns (time + 7 days), 2 rows (header + body)
  var html = '<div class="wk-grid">';

  // Row 1: header cells
  html += `<div class="wk-corner"><button class="week-settings-btn" id="week-settings-btn" onclick="toggleWeekSettings()" title="Calendar settings"><span class="material-symbols-outlined" style="font-size:14px">add</span></button></div>`;
  days.forEach((d, i) => {
    const accessible = (!accessibleStartDate || d >= accessibleStartDate) && (!accessibleEndDate || d <= accessibleEndDate);
    const isToday = accessible && d === todayStr;
    if (accessible) {
      const dayNum = parseInt(d.slice(8));
      html += `<div class="wk-day-hdr${isToday ? ' wk-today' : ''}">${dayNames[i]} ${dayNum}</div>`;
    } else {
      html += `<div class="wk-day-hdr wk-inaccessible"></div>`;
    }
  });

  // Row 2: time column + day columns (all inside a scrollable cell that spans the row)
  html += `<div class="wk-time-col" style="height:${TOTAL_H}px">`;
  for (let h = 0; h <= 24; h += weekIntervalHrs) {
    var tickLabel = formatHourLabel(h);
    if (weekIntervalHrs < 1 && h !== Math.floor(h)) {
      var hh = Math.floor(h); var mm = Math.round((h - hh) * 60);
      if (use24HourTime) tickLabel = String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
      else { var ampm = hh >= 12 ? 'PM' : 'AM'; var h12 = hh % 12 || 12; tickLabel = h12 + ':' + String(mm).padStart(2,'0') + ' ' + ampm; }
    }
    html += `<div class="wk-tick" style="top:${TICK_MARGIN + h * HOUR_PX}px">${tickLabel}</div>`;
  }
  html += '</div>';

  days.forEach((d, di) => {
    const accessible = (!accessibleStartDate || d >= accessibleStartDate) && (!accessibleEndDate || d <= accessibleEndDate);
    const isToday = accessible && d === todayStr;
    const cls = accessible ? (isToday ? ' wk-today' : '') : ' wk-inaccessible';
    html += `<div class="wk-day-col${cls}" style="height:${TOTAL_H}px">`;

    for (let h = 0; h <= 24; h += weekIntervalHrs) {
      html += `<div class="wk-gridline" style="top:${TICK_MARGIN + h * HOUR_PX}px"></div>`;
    }

    if (accessible) {
      const daySessions = sessions.filter(s => s.dayStr === d);
      const cards = daySessions.filter(s => s.durationMin >= MIN_CARD_MINUTES);
      const lines = daySessions.filter(s => s.durationMin < MIN_CARD_MINUTES);

      // --- Concurrent card layout ---
      // Determine parent/child relationships and overlap groups
      function isAncestor(parentSession, childSession) {
        if (parentSession.taskId === childSession.taskId) return false;
        var parentPath = (parentSession.path || '/').replace(/\/$/, '') + '/' + parentSession.taskName + '/';
        return (childSession.path || '/').startsWith(parentPath);
      }
      function sessionsOverlap(a, b) {
        return a.startFrac < b.endFrac && b.startFrac < a.endFrac;
      }

      // Build layout info for each card: left%, width%, inset level
      var cardLayouts = cards.map(function() { return { left: 0, width: 100, insetLevel: 0 }; });

      // Step 1: Find concurrent sibling groups (non-ancestor overlaps)
      // Use a sweep-line approach to assign columns to overlapping siblings
      var assigned = new Array(cards.length).fill(-1);
      for (var ci = 0; ci < cards.length; ci++) {
        if (assigned[ci] >= 0) continue;
        // Find all cards in this overlap cluster (transitively connected)
        var cluster = [ci];
        var queue = [ci];
        while (queue.length > 0) {
          var cur = queue.shift();
          for (var cj = 0; cj < cards.length; cj++) {
            if (cluster.indexOf(cj) >= 0) continue;
            if (sessionsOverlap(cards[cur], cards[cj]) && !isAncestor(cards[cur], cards[cj]) && !isAncestor(cards[cj], cards[cur])) {
              cluster.push(cj);
              queue.push(cj);
            }
          }
        }
        // Remove parent/child pairs from the cluster — they don't compete for columns
        var siblings = cluster.filter(function(idx) {
          for (var k = 0; k < cluster.length; k++) {
            if (k === idx) continue;
            if (isAncestor(cards[cluster[k]], cards[idx])) return false;
          }
          return true;
        });
        // Assign columns to siblings using greedy coloring
        var cols = {};
        siblings.sort(function(a, b) { return cards[a].startFrac - cards[b].startFrac; });
        var maxCol = 0;
        siblings.forEach(function(idx) {
          var col = 0;
          while (true) {
            var conflict = false;
            for (var k = 0; k < siblings.length; k++) {
              if (cols[siblings[k]] === col && sessionsOverlap(cards[siblings[k]], cards[idx])) {
                conflict = true; break;
              }
            }
            if (!conflict) break;
            col++;
          }
          cols[idx] = col;
          if (col > maxCol) maxCol = col;
        });
        var totalCols = maxCol + 1;
        var colWidth = 100 / totalCols;
        siblings.forEach(function(idx) {
          cardLayouts[idx].left = cols[idx] * colWidth;
          cardLayouts[idx].width = colWidth;
          assigned[idx] = cols[idx];
        });
        // Now handle children: inset within their parent's bounds
        var children = cluster.filter(function(idx) { return siblings.indexOf(idx) < 0; });
        children.forEach(function(childIdx) {
          // Find the immediate parent in the cluster
          var parentIdx = -1;
          var deepestPathLen = 0;
          for (var k = 0; k < cluster.length; k++) {
            if (k === childIdx) continue;
            if (isAncestor(cards[cluster[k]], cards[childIdx])) {
              var pPath = (cards[cluster[k]].path || '/').length;
              if (pPath > deepestPathLen) { deepestPathLen = pPath; parentIdx = cluster[k]; }
            }
          }
          if (parentIdx >= 0) {
            var pLayout = cardLayouts[parentIdx];
            var INSET_PCT = 8; // percentage inset from each side of parent
            cardLayouts[childIdx].left = pLayout.left + INSET_PCT;
            cardLayouts[childIdx].width = pLayout.width - 2 * INSET_PCT;
            cardLayouts[childIdx].insetLevel = (cardLayouts[parentIdx].insetLevel || 0) + 1;
          } else {
            assigned[childIdx] = 0;
          }
        });
      }

      cards.forEach(function(s, idx) {
        const top = TICK_MARGIN + s.startFrac * HOUR_PX;
        const height = Math.max(4, (s.endFrac - s.startFrac) * HOUR_PX - 2);
        const showLabel = height >= 14;
        const sessionSuffix = s.totalSessions > 1 ? ' (' + s.sessionIndex + ')' : '';
        const label = showLabel ? escHtml(s.taskName) + sessionSuffix : '';
        const tooltip = escHtml(s.taskName) + sessionSuffix;
        var evColor = s.color ? ';background:' + s.color : '';
        var layout = cardLayouts[idx];
        var zIndex = layout.insetLevel || 0;
        html += `<div class="wk-event" style="top:${top.toFixed(1)}px;height:${height.toFixed(1)}px;left:${layout.left.toFixed(1)}%;width:${layout.width.toFixed(1)}%${evColor};z-index:${zIndex}" title="${tooltip}">${label}</div>`;
      });

      if (lines.length > 0) {
        const buckets = {};
        lines.forEach(s => { const bucket = Math.floor(s.startFrac * 6); if (!buckets[bucket]) buckets[bucket] = []; buckets[bucket].push(s); });
        Object.keys(buckets).forEach(b => {
          const group = buckets[b]; const earliest = Math.min(...group.map(s => s.startFrac));
          const top = TICK_MARGIN + earliest * HOUR_PX;
          const names = group.map(s => { var suffix = s.totalSessions > 1 ? ' (' + s.sessionIndex + ')' : ''; return s.taskName + suffix; });
          const title = names.join(', ');
          var lineColor = group[0].color ? ';background:' + group[0].color : '';
          html += `<div class="wk-line" style="top:${top.toFixed(1)}px${lineColor}" title="${escHtml(title)}"></div>`;
        });
      }

      // Due cards
      var DUE_CARD_H = 16;
      var FIVE_MIN_PX = HOUR_PX * (5 / 60);
      var dayDueTasks = dueTasks.filter(function(t) { return utcToLocalDate(t.due_datetime) === d; });
      if (dayDueTasks.length > 0) {
        // Collect occupied ranges [top, bottom] from session cards
        var occupied = [];
        cards.forEach(function(s) {
          var cTop = TICK_MARGIN + s.startFrac * HOUR_PX;
          var cH = Math.max(4, (s.endFrac - s.startFrac) * HOUR_PX - 2);
          occupied.push([cTop, cTop + cH]);
        });
        dayDueTasks.forEach(function(t) {
          var dueFrac = getLocalHourFrac(t.due_datetime);
          var bottom = TICK_MARGIN + dueFrac * HOUR_PX;
          var cardTop = bottom - DUE_CARD_H;
          // Resolve collisions: search upward in 5-min increments
          var attempts = 0;
          while (attempts < 200) {
            var hasOverlap = false;
            for (var oi = 0; oi < occupied.length; oi++) {
              if (cardTop < occupied[oi][1] && cardTop + DUE_CARD_H > occupied[oi][0]) {
                hasOverlap = true; break;
              }
            }
            if (!hasOverlap) break;
            cardTop -= FIVE_MIN_PX;
            attempts++;
          }
          if (cardTop < TICK_MARGIN) cardTop = TICK_MARGIN;
          var DUE_GAP = 4;
          occupied.push([cardTop - DUE_GAP, cardTop + DUE_CARD_H + DUE_GAP]);
          html += '<div class="wk-due-card" style="top:' + cardTop.toFixed(1) + 'px"><div class="wk-due-label">' + escHtml(t.name) + '</div></div>';
        });
      }

      // Action cards (planned = dashed, manifested = solid)
      var dayActions = weekActions.filter(function(a) { return utcToLocalDate(a.start_datetime) === d; });
      dayActions.forEach(function(a) {
        var aStartFrac = getLocalHourFrac(a.start_datetime);
        var aEndFrac = a.end_datetime ? getLocalHourFrac(a.end_datetime) : aStartFrac + 0.5;
        if (aEndFrac <= aStartFrac) aEndFrac = aStartFrac + (1/60);
        var aTop = TICK_MARGIN + aStartFrac * HOUR_PX;
        var aHeight = Math.max(4, (aEndFrac - aStartFrac) * HOUR_PX - 2);
        var showLabel = aHeight >= 14;
        var aColor = getFolderColor(a.folder_id) || '#5f6368';
        var isPlanned = !!a.is_planned;
        var cssClass = isPlanned ? 'wk-action wk-action-planned' : 'wk-action';
        var style = 'top:' + aTop.toFixed(1) + 'px;height:' + aHeight.toFixed(1) + 'px;';
        if (isPlanned) {
          style += 'border-color:' + aColor + ';color:' + aColor + ';';
        } else {
          style += 'background:' + aColor + ';';
        }
        var label = showLabel ? escHtml(a.name) : '';
        var tooltip = escHtml(a.name);
        var clickAttr = isPlanned ? ' onclick="manifestAction(\'' + a.action_id + '\')"' : '';
        html += '<div class="' + cssClass + '" style="' + style + '" title="' + tooltip + '"' + clickAttr + '>' + label + '</div>';
      });
    }
    html += '</div>';
  });

  html += '</div>';
  root.innerHTML = html;

  // Set scroll position based on weekScrollOffset
  root.scrollTop = weekScrollOffset * cellH;

  // Update visible cells label in dropdown
  var cellInput = document.getElementById('wk-visible-cells-input');
  if (cellInput) { cellInput.value = weekVisibleCells; cellInput.max = totalIntervals; }

  const dashLabel = document.getElementById('dash-week-label');
  if (dashLabel) dashLabel.textContent = days[0].slice(5) + ' \u2013 ' + days[6].slice(5);

  // Current-time dashed line
  if (nowLineInterval) { clearTimeout(nowLineInterval); nowLineInterval = null; }
  var todayIdx = days.indexOf(todayStr);
  if (todayIdx >= 0) {
    // Insert the line into today's day column (todayIdx-th day col, 0-based)
    var dayCols = root.querySelectorAll('.wk-day-col');
    var todayCol = dayCols[todayIdx];
    if (todayCol) {
      var nowLine = document.createElement('div');
      nowLine.id = 'wk-now-line';
      todayCol.appendChild(nowLine);
      // Position it
      function updateNowLine() {
        var nowFrac = getLocalHourFrac(new Date().toISOString());
        nowLine.style.top = (TICK_MARGIN + nowFrac * HOUR_PX) + 'px';
        // Check if day changed
        var newToday = getTodayStr();
        if (newToday !== todayStr) {
          if (nowLineInterval) { clearTimeout(nowLineInterval); nowLineInterval = null; }
          renderWeekView();
          return;
        }
        // Schedule next update to fire exactly on the next minute boundary
        var secsUntilNextMin = 60 - new Date().getSeconds();
        nowLineInterval = setTimeout(updateNowLine, secsUntilNextMin * 1000);
      }
      updateNowLine();
    }
  }
}

function setTimeFormat(is24) {
  use24HourTime = is24;
  savePreferences();
  if (currentPage === 'weekly') {
    updateWeekSettingsUI();
    renderWeekView();
  } else if (currentPage === 'dashboard') {
    var pills = document.querySelectorAll('.time-pill-toggle button');
    if (pills.length === 2) {
      pills[0].classList.toggle('active', is24);
      pills[1].classList.toggle('active', !is24);
    }
  }
  else renderCalendarFromCache();
}

function toggleWeekSettings() {
  var dd = document.getElementById('week-settings-dd');
  if (!dd) return;
  dd.classList.toggle('open');
  // Position dropdown to the right of and below the button
  if (dd.classList.contains('open')) {
    var btn = document.getElementById('week-settings-btn');
    if (btn) {
      var r = btn.getBoundingClientRect();
      dd.style.top = (r.bottom + 4) + 'px';
      dd.style.left = (r.left) + 'px';
    }
  }
  var btn2 = document.getElementById('week-settings-btn');
  if (btn2) {
    var icon = btn2.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = dd.classList.contains('open') ? 'remove' : 'add';
  }
}

function setWeekInterval(hrs) {
  // Adjust visible cells to maintain similar visual density
  var oldTotal = Math.round(24 / weekIntervalHrs);
  weekIntervalHrs = hrs;
  var newTotal = Math.round(24 / weekIntervalHrs);
  // Scale visible cells proportionally
  weekVisibleCells = Math.round(weekVisibleCells * newTotal / oldTotal);
  if (weekVisibleCells < 6) weekVisibleCells = 6;
  if (weekVisibleCells > newTotal) weekVisibleCells = newTotal;
  // Clamp scroll offset
  var maxOffset = newTotal - weekVisibleCells;
  if (weekScrollOffset > maxOffset) weekScrollOffset = maxOffset;
  if (weekScrollOffset < 0) weekScrollOffset = 0;
  // Update input max and value
  var inp = document.getElementById('wk-visible-cells-input');
  if (inp) { inp.max = newTotal; inp.value = weekVisibleCells; }
  savePreferences();
  updateWeekSettingsUI();
  renderWeekView();
}

function setVisibleCells(n) {
  var totalIntervals = Math.round(24 / weekIntervalHrs);
  n = Math.round(n);
  if (isNaN(n) || n < 6) n = 6;
  if (n > totalIntervals) n = totalIntervals;
  weekVisibleCells = n;
  var maxOffset = totalIntervals - weekVisibleCells;
  if (weekScrollOffset > maxOffset) weekScrollOffset = maxOffset;
  if (weekScrollOffset < 0) weekScrollOffset = 0;
  // Update input if it exists
  var inp = document.getElementById('wk-visible-cells-input');
  if (inp) inp.value = weekVisibleCells;
  savePreferences();
  renderWeekView();
}

function setVisibleCellsFromInput(el) {
  var val = parseInt(el.value);
  if (isNaN(val) || val < 1) val = 6;
  setVisibleCells(val);
  // Ensure the input shows the clamped value
  el.value = weekVisibleCells;
}

function weekScroll(delta) {
  var totalIntervals = Math.round(24 / weekIntervalHrs);
  var maxOffset = totalIntervals - weekVisibleCells;
  weekScrollOffset += delta;
  if (weekScrollOffset < 0) weekScrollOffset = 0;
  if (weekScrollOffset > maxOffset) weekScrollOffset = maxOffset;
  // Just update scroll position, no full re-render needed
  var root = document.getElementById('weekly-root');
  if (root) {
    var hdrEl = document.getElementById('weekly-header');
    var headerH = hdrEl ? hdrEl.offsetHeight : 39;
    var cellH = (window.innerHeight - headerH - 16) / weekVisibleCells; // 16 = 2*TICK_MARGIN
    root.scrollTop = weekScrollOffset * cellH;
  }
}

function updateWeekSettingsUI() {
  // Update toggle states in the dropdown
  var dd = document.getElementById('week-settings-dd');
  if (!dd) return;
  var fmtBtns = dd.querySelectorAll('.time-pill-toggle')[0];
  if (fmtBtns) {
    var btns = fmtBtns.querySelectorAll('button');
    if (btns.length === 2) { btns[0].classList.toggle('active', use24HourTime); btns[1].classList.toggle('active', !use24HourTime); }
  }
  var intBtns = dd.querySelectorAll('.time-pill-toggle')[1];
  if (intBtns) {
    var btns2 = intBtns.querySelectorAll('button');
    if (btns2.length === 3) {
      btns2[0].classList.toggle('active', weekIntervalHrs === 0.5);
      btns2[1].classList.toggle('active', weekIntervalHrs === 1);
      btns2[2].classList.toggle('active', weekIntervalHrs === 2);
    }
  }
  var pxInput = document.getElementById('week-interval-px-input');
  if (pxInput) pxInput.value = weekIntervalPx;
}

function toggleTimeFormat() { setTimeFormat(!use24HourTime); }

// Navigate to the weekly tab showing the week that contains the given date
function goToWeekOf(dateStr) {
  // dateStr is "YYYY-MM-DD"
  var parts = dateStr.split('-').map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  // Find Sunday of that week
  var day = d.getDay();
  var sunday = new Date(d);
  sunday.setDate(sunday.getDate() - day);
  // Check boundary — compute the 7 days
  var days = [];
  for (var i = 0; i < 7; i++) { var wd = new Date(sunday); wd.setDate(wd.getDate() + i); days.push(fmtDate(wd)); }
  if (accessibleStartDate && days[6] < accessibleStartDate) return;
  if (accessibleEndDate && days[0] > accessibleEndDate) return;
  weekCalStart = sunday;
  navigateTo('weekly');
}

function changeWeek(delta) {
  if (!weekCalStart) initWeekStart();
  var candidate = new Date(weekCalStart);
  candidate.setDate(candidate.getDate() + delta * 7);
  // Compute the 7 days of the candidate week
  var candDays = [];
  for (var ci = 0; ci < 7; ci++) { var cd = new Date(candidate); cd.setDate(cd.getDate() + ci); candDays.push(fmtDate(cd)); }
  // Block if the entire week is outside the accessible range
  if (accessibleStartDate && candDays[6] < accessibleStartDate) return;
  if (accessibleEndDate && candDays[0] > accessibleEndDate) return;
  weekCalStart = candidate;
  // Update the dashboard week label
  var dashLabel = document.getElementById('dash-week-label');
  if (dashLabel) {
    dashLabel.textContent = candDays[0].slice(5) + ' \u2013 ' + candDays[6].slice(5);
  }
  if (currentPage === 'weekly') { renderWeekView(); updateWeeklySubtab(); }
  else if (currentPage !== 'dashboard') loadCalendar();
}

// === Right-click context menu ===
(function() {
  var menu = null;

  function buildMenu() {
    if (menu) menu.remove();
    menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = '<button class="ctx-menu-item" data-action="quickadd">' +
      '<span class="material-symbols-outlined">task_alt</span> Task</button>' +
      '<button class="ctx-menu-item" data-action="action">' +
      '<span class="material-symbols-outlined">schedule</span> Action</button>' +
      '<button class="ctx-menu-item" data-action="note">' +
      '<span class="material-symbols-outlined">note</span> Note</button>' +
      '<button class="ctx-menu-item" data-action="folder">' +
      '<span class="material-symbols-outlined">folder</span> Folder</button>' +
      '<button class="ctx-menu-item" data-action="drafts" id="ctx-drafts-item">' +
      '<span class="material-symbols-outlined">draft</span> Drafts' +
      '<span class="material-symbols-outlined" style="margin-left:auto;font-size:0.9rem">chevron_right</span>' +
      '<div class="ctx-submenu" id="ctx-drafts-submenu"></div></button>';
    document.body.appendChild(menu);

    menu.querySelector('[data-action="quickadd"]').addEventListener('click', function() {
      closeCtxMenu(); openQuickAdd();
    });
    menu.querySelector('[data-action="action"]').addEventListener('click', function() {
      closeCtxMenu(); openActionAdd();
    });
    menu.querySelector('[data-action="note"]').addEventListener('click', function() {
      closeCtxMenu(); openNoteAdd();
    });
    menu.querySelector('[data-action="folder"]').addEventListener('click', function() {
      closeCtxMenu(); openFolderModal(null);
    });

    var draftsItem = menu.querySelector('[data-action="drafts"]');
    var submenu = document.getElementById('ctx-drafts-submenu');
    draftsItem.addEventListener('mouseenter', function() { showDraftsSubmenu(submenu); });
    draftsItem.addEventListener('click', function(e) {
      if (e.target === draftsItem || e.target.closest('[data-action="drafts"]') === draftsItem) {
        showDraftsSubmenu(submenu);
      }
    });
  }

  function showDraftsSubmenu(submenu) {
    if (prodDrafts.length === 0) {
      submenu.innerHTML = '<div class="ctx-submenu-empty">No drafts</div>';
    } else {
      submenu.innerHTML = prodDrafts.map(function(d) {
        var icon, label;
        if (d.draft_type === 'note') { icon = 'note'; label = 'Note'; }
        else if (d.draft_type === 'folder') { icon = 'folder'; label = 'Folder'; }
        else if (d.is_routine_draft) { icon = 'repeat'; label = 'Routine'; }
        else { icon = 'draft'; label = 'Task'; }
        return '<button class="ctx-submenu-item" data-draft-id="' + d.draft_id + '">' +
          '<span class="material-symbols-outlined" style="font-size:0.95rem;color:#9aa0a6">' + icon + '</span> ' +
          escHtml(d.name || 'Untitled draft') +
          '<span style="margin-left:auto;font-size:0.72rem;color:#9aa0a6">' + label + '</span></button>';
      }).join('');
      submenu.querySelectorAll('[data-draft-id]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var draftId = btn.dataset.draftId;
          closeCtxMenu();
          resumeDraft(draftId);
        });
      });
    }
    // Position submenu: flip left if it would overflow right edge
    submenu.classList.add('open');
    var rect = submenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      submenu.style.left = 'auto';
      submenu.style.right = '100%';
    }
    if (rect.bottom > window.innerHeight) {
      submenu.style.top = 'auto';
      submenu.style.bottom = '0';
    }
  }

  function closeCtxMenu() {
    if (menu) menu.classList.remove('open');
    var sub = document.getElementById('ctx-drafts-submenu');
    if (sub) { sub.classList.remove('open'); sub.style.left = ''; sub.style.right = ''; sub.style.top = ''; sub.style.bottom = ''; }
  }

  document.addEventListener('contextmenu', function(e) {
    // Don't intercept on input/textarea/select elements
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Only intercept inside the app (not on login/home pages)
    if (!document.getElementById('app-content')) return;
    e.preventDefault();
    buildMenu();
    // Position at cursor, flip if near edge
    var x = e.clientX, y = e.clientY;
    menu.classList.add('open');
    var mRect = menu.getBoundingClientRect();
    if (x + mRect.width > window.innerWidth) x = window.innerWidth - mRect.width - 4;
    if (y + mRect.height > window.innerHeight) y = window.innerHeight - mRect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  });

  document.addEventListener('click', function(e) {
    if (menu && !menu.contains(e.target)) closeCtxMenu();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeCtxMenu();
  });
})();

// === Card Stack Manager ===
var CardStack = {
  stack: [],
  overlay: null,
  MAX_VISIBLE: 5,

  getOverlay: function() {
    if (this.overlay) return this.overlay;
    this.overlay = document.createElement('div');
    this.overlay.className = 'quickadd-overlay';
    document.body.appendChild(this.overlay);
    var self = this;
    this.overlay.addEventListener('click', function(e) {
      if (e.target === self.overlay) self.dismissTop();
    });
    this.overlay.addEventListener('keydown', function(e) {
      if (self.stack.length === 0) return;
      var top = self.stack[self.stack.length - 1];
      if (e.key === 'Escape') { self.dismissTop(); e.preventDefault(); return; }
      // Let card-specific handler run first (e.g. Group hex input blocks Enter)
      if (top._onOverlayKeydown) top._onOverlayKeydown(e);
      if (e.defaultPrevented) return;
      if (e.key === 'Enter') {
        // Only submit if focused element is inside topmost card
        if (top.el.contains(document.activeElement)) {
          e.preventDefault();
          top.onSubmit();
        }
      }
    });
    return this.overlay;
  },

  push: function(card) {
    var ov = this.getOverlay();
    this.stack.push(card);
    ov.appendChild(card.el);
    ov.classList.add('open');
    this.reposition();
    setTimeout(function() {
      var firstInput = card.el.querySelector('input:not([type=hidden])');
      if (firstInput) firstInput.focus();
    }, 50);
  },

  pop: function() {
    if (this.stack.length === 0) return;
    var card = this.stack.pop();
    card.el.remove();
    if (this.stack.length === 0) {
      this.overlay.classList.remove('open');
    } else {
      this.reposition();
    }
    return card;
  },

  dismissTop: function() {
    if (this.stack.length === 0) return;
    var card = this.stack[this.stack.length - 1];
    if (card.onDismiss) card.onDismiss();
    this.pop();
  },

  remove: function(card) {
    var idx = this.stack.indexOf(card);
    if (idx < 0) return;
    this.stack.splice(idx, 1);
    card.el.remove();
    if (this.stack.length === 0) {
      this.overlay.classList.remove('open');
    } else {
      this.reposition();
    }
  },
  reposition: function() {
    var total = this.stack.length;
    if (total === 0) return;
    var visibleStart = Math.max(0, total - this.MAX_VISIBLE);
    // Restore any overflow badge headers
    for (var j = 0; j < total; j++) {
      if (this.stack[j]._origHeaderText !== undefined) {
        var hdr = this.stack[j].el.querySelector('.quickadd-header');
        if (hdr) hdr.textContent = this.stack[j]._origHeaderText;
        delete this.stack[j]._origHeaderText;
      }
    }
    // Reset top card width so it returns to natural size, then measure it
    var topCard = this.stack[total - 1];
    topCard.el.style.width = '';
    var frontWidth = topCard.el.getBoundingClientRect().width;

    for (var i = 0; i < total; i++) {
      var card = this.stack[i];
      if (i < visibleStart) {
        card.el.classList.add('stack-hidden');
        continue;
      }
      card.el.classList.remove('stack-hidden');
      var posFromTop = (total - 1) - i;
      var xOffset = posFromTop * 12;
      var yOffset = posFromTop * 36;
      card.el.style.transform = 'translate(calc(-50% - ' + xOffset + 'px), calc(-50% - ' + yOffset + 'px))';
      card.el.style.zIndex = 10 - posFromTop;
      if (posFromTop === 0) {
        card.el.classList.remove('is-stacked-behind');
        card.el.style.width = '';
      } else {
        card.el.classList.add('is-stacked-behind');
        card.el.style.width = frontWidth + 'px';
      }
    }
    this.updateOverflowBadge();
  },

  updateOverflowBadge: function() {
    var total = this.stack.length;
    if (total <= this.MAX_VISIBLE) return;
    var hiddenCount = total - this.MAX_VISIBLE;
    var oldestVisible = this.stack[total - this.MAX_VISIBLE];
    var header = oldestVisible.el.querySelector('.quickadd-header');
    if (header) {
      oldestVisible._origHeaderText = header.textContent;
      header.textContent = '+ ' + (hiddenCount + 1) + ' more';
    }
  }
};
window.CardStack = CardStack;

// Helper: scoped query inside a card element
function _q(el, cls) { return el.querySelector('.' + cls); }

// === QuickAdd Factory ===
function createQuickAddCard() {
  var cardEl = document.createElement('div');
  cardEl.className = 'quickadd-card quickadd-has-protrusion';
  cardEl.innerHTML =
    '<div class="quickadd-header qa-header">Task</div>' +
    '<div class="quickadd-body">' +
    '<input class="quickadd-input qa-name" placeholder="Name" autocomplete="off">' +
    '<input class="quickadd-input qa-assign" placeholder="Assign" autocomplete="off">' +
    '<input class="quickadd-input qa-due" placeholder="Due" autocomplete="off">' +
    '<input class="quickadd-input qa-folder" placeholder="Folder" autocomplete="off">' +
    '</div>' +
    '<div class="qa-routine-row qa-routine-row-el" style="display:none">' +
    '<input class="quickadd-input qa-start" placeholder="Start day" autocomplete="off">' +
    '<input class="quickadd-input qa-pattern" placeholder="Pattern (e.g. daily, weekdays)" autocomplete="off">' +
    '<input class="quickadd-input qa-mode-field" placeholder="" autocomplete="off" style="display:none">' +
    '</div>' +
    '<div class="qa-plus-protrusion">' +
    '<div class="qa-plus-btn" tabindex="0" role="button">+</div>' +
    '<span class="qa-mode-selector" style="display:none">' +
    '<span class="qa-mode-opt qa-mode-1" tabindex="0">1</span>' +
    '<span class="qa-mode-slash">/</span>' +
    '<span class="qa-mode-opt qa-mode-2" tabindex="0">2</span>' +
    '<span class="qa-mode-desc">1 for fixed # times, 2 for fixed end date</span>' +
    '</span>' +
    '</div>';

  // Scoped references
  var folderInput = _q(cardEl, 'qa-folder');
  var plusBtn = _q(cardEl, 'qa-plus-btn');
  var modeSelector = _q(cardEl, 'qa-mode-selector');
  var routineRow = _q(cardEl, 'qa-routine-row-el');
  var modeField = _q(cardEl, 'qa-mode-field');
  var qaMode = 0;

  function updateColor() {
    var folderVal = folderInput.value.trim();
    var color = DEFAULT_COLOR;
    if (folderVal) {
      var folder = resolveFolderInput(folderVal);
      if (folder && folder.color) color = folder.color;
    }
    cardEl.style.borderColor = color;
    cardEl.style.setProperty('--qa-border-color', color);
    _q(cardEl, 'qa-header').style.backgroundColor = color;
  }

  folderInput.addEventListener('input', updateColor);
  folderInput.addEventListener('change', updateColor);

  function collapseToTask() {
    qaMode = 0;
    modeSelector.style.display = 'none';
    routineRow.style.display = 'none';
    modeField.style.display = 'none';
    _q(cardEl, 'qa-header').textContent = 'Task';
    updateColor();
    plusBtn.textContent = '+';
  }

  function togglePlus() {
    if (qaMode > 0 || modeSelector.style.display !== 'none') {
      collapseToTask();
    } else {
      modeSelector.style.display = '';
      plusBtn.textContent = '\u2212';
      _q(cardEl, 'qa-mode-1').focus();
    }
  }
  plusBtn.addEventListener('click', togglePlus);
  plusBtn.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePlus(); }
  });

  function selectMode(mode) {
    qaMode = mode;
    modeSelector.style.display = 'none';
    routineRow.style.display = 'flex';
    modeField.style.display = '';
    if (mode === 1) {
      modeField.placeholder = '# Instances';
      modeField.type = 'number';
      modeField.min = '2';
    } else {
      modeField.placeholder = 'End day';
      modeField.type = 'text';
    }
    modeField.value = '';
    _q(cardEl, 'qa-header').textContent = 'Routine';
    updateColor();
    _q(cardEl, 'qa-start').focus();
  }

  _q(cardEl, 'qa-mode-1').addEventListener('click', function() { selectMode(1); });
  _q(cardEl, 'qa-mode-2').addEventListener('click', function() { selectMode(2); });
  _q(cardEl, 'qa-mode-1').addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(1); } });
  _q(cardEl, 'qa-mode-2').addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(2); } });

  updateColor();

  var card = {
    type: 'task',
    el: cardEl,
    draftId: null,
    _onOverlayKeydown: function(e) {
      if (modeSelector.style.display !== 'none' && qaMode === 0) {
        if (e.key === '1') { e.preventDefault(); selectMode(1); return; }
        if (e.key === '2') { e.preventDefault(); selectMode(2); return; }
      }
    },
    onSubmit: function() { submitThisQuickAdd(); },
    onDismiss: function() {
      // QuickAdd has no draft auto-save — just dismiss
    }
  };

  function submitThisQuickAdd() {
    var nameVal = _q(cardEl, 'qa-name').value.trim();
    var assignVal = _q(cardEl, 'qa-assign').value.trim();
    var dueVal = _q(cardEl, 'qa-due').value.trim();
    var folderVal = _q(cardEl, 'qa-folder').value.trim();
    var isRoutine = routineRow && routineRow.style.display !== 'none';

    if (isRoutine) { submitQuickAddRoutine(card, cardEl, nameVal, assignVal, dueVal, folderVal); return; }

    if (!nameVal) { alert('Name is required.'); _q(cardEl, 'qa-name').focus(); return; }

    var assignDt = null;
    if (assignVal) {
      var parsed = parseNaturalDate(assignVal, '00:00');
      if (parsed) { assignDt = localInputToUTC(parsed.date + 'T' + parsed.time); }
      else { assignDt = localInputToUTC(assignVal); }
    }
    if (!assignDt) { alert('Could not parse assign date. Try: "today", "tomorrow", "thursday 5 pm", etc.'); _q(cardEl, 'qa-assign').focus(); return; }

    var dueDt = null;
    if (dueVal) {
      var parsedDue = parseNaturalDate(dueVal, '23:59');
      if (parsedDue) { dueDt = localInputToUTC(parsedDue.date + 'T' + parsedDue.time); }
      else { dueDt = localInputToUTC(dueVal); }
    }
    if (!dueDt) { alert('Could not parse due date. Try: "today", "friday 10 am", "next monday", etc.'); _q(cardEl, 'qa-due').focus(); return; }

    var folder = folderVal ? resolveFolderInput(folderVal) : null;
    if (folderVal && !folder) { alert('Folder not found. Create it first or use its exact name.'); _q(cardEl, 'qa-folder').focus(); return; }
    var data = { name: nameVal, assign_datetime: assignDt, due_datetime: dueDt, folder_id: folder ? folder.id : null, path: '/', draft: false };

    var createFoldersThenTask = function() {
      fetch('/api/tasks', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() { CardStack.remove(card); refreshData(); })
        .catch(function(err) { alert(err.message || 'Failed to create task.'); });
    };

    createFoldersThenTask();
  }

  return card;
}

function submitQuickAddRoutine(card, cardEl, nameVal, assignVal, dueVal, folderVal) {
  if (!nameVal) { alert('Name is required.'); _q(cardEl, 'qa-name').focus(); return; }

  var startVal = _q(cardEl, 'qa-start').value.trim();
  var patternVal = _q(cardEl, 'qa-pattern').value.trim();
  var modeFieldEl = _q(cardEl, 'qa-mode-field');
  var modeFieldVal = modeFieldEl.value.trim();
  var isEndDateMode = modeFieldEl.placeholder === 'End day';

  var assignTime = null;
  if (assignVal) {
    var ap = parseNaturalDate(assignVal, '00:00');
    assignTime = ap ? ap.time : '00:00';
  }

  var dueTime = null;
  if (dueVal) {
    var dp = parseNaturalDate(dueVal, '23:59');
    dueTime = dp ? dp.time : '23:59';
  }

  var firstDay = null;
  if (startVal) {
    var sp = parseNaturalDate(startVal, '00:00');
    if (sp) { firstDay = sp.date; }
    else {
      var sd = new Date(startVal + 'T00:00:00');
      if (!isNaN(sd.getTime())) firstDay = fmtDate(sd);
    }
  }
  if (!firstDay) { alert('Could not parse start day. Try: "today", "tomorrow", "next monday", etc.'); _q(cardEl, 'qa-start').focus(); return; }

  var pattern = parsePatternInput(patternVal);
  if (!pattern) { alert('Could not parse pattern. Try: "daily", "weekdays", "every 2 days", "every mon wed fri".'); _q(cardEl, 'qa-pattern').focus(); return; }

  var routineData = {
    name: nameVal, assign_time: assignTime || '00:00', due_time: dueTime || '23:59',
    first_day: firstDay, pattern: pattern, folder_id: null
  };

  if (isEndDateMode) {
    if (!modeFieldVal) { alert('End day is required.'); modeFieldEl.focus(); return; }
    var ep = parseNaturalDate(modeFieldVal, '00:00');
    var endDay = null;
    if (ep) { endDay = ep.date; }
    else { var ed = new Date(modeFieldVal + 'T00:00:00'); if (!isNaN(ed.getTime())) endDay = fmtDate(ed); }
    if (!endDay) { alert('Could not parse end day.'); modeFieldEl.focus(); return; }
    routineData.end_date = endDay;
  } else {
    var instVal = parseInt(modeFieldVal);
    if (!instVal || instVal < 2) { instVal = computeMaxInstancesClientSide(firstDay, pattern); }
    routineData.max_instances = instVal;
  }

  var routineFolder = folderVal ? resolveFolderInput(folderVal) : null;
  if (folderVal && !routineFolder) { alert('Folder not found. Create it first or use its exact name.'); _q(cardEl, 'qa-folder').focus(); return; }
  routineData.folder_id = routineFolder ? routineFolder.id : null;

  var createRoutine = function() {
    fetch('/api/routines', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(routineData)})
      .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
      .then(function() { CardStack.remove(card); refreshData(); })
      .catch(function(err) { alert(err.message || 'Failed to create routine.'); });
  };

  createRoutine();
}

window.openQuickAdd = function() {
  CardStack.push(createQuickAddCard());
};

window.closeQuickAdd = function() {
  CardStack.dismissTop();
};

// === ActionAdd Factory ===
function createActionCard() {
  var cardEl = document.createElement('div');
  cardEl.className = 'quickadd-card quickadd-has-protrusion';
  cardEl.innerHTML =
    '<div class="quickadd-header qa-header" style="background:#5f6368">Action</div>' +
    '<div class="quickadd-body">' +
    '<input class="quickadd-input qa-name" placeholder="Name" autocomplete="off">' +
    '<input class="quickadd-input qa-start-dt" placeholder="Start (e.g. today 8:30 am)" autocomplete="off">' +
    '<input class="quickadd-input qa-end-dt" placeholder="End (e.g. today 10 am)" autocomplete="off">' +
    '<input class="quickadd-input qa-folder" placeholder="Folder" autocomplete="off">' +
    '</div>' +
    '<div class="qa-routine-row qa-schedule-row-el" style="display:none">' +
    '<input class="quickadd-input qa-start-day" placeholder="Start day" autocomplete="off">' +
    '<input class="quickadd-input qa-pattern" placeholder="Pattern (e.g. daily, weekdays)" autocomplete="off">' +
    '<input class="quickadd-input qa-mode-field" placeholder="" autocomplete="off" style="display:none">' +
    '</div>' +
    '<div class="qa-plus-protrusion">' +
    '<div class="qa-plus-btn" tabindex="0" role="button">+</div>' +
    '<span class="qa-mode-selector" style="display:none">' +
    '<span class="qa-mode-opt qa-mode-1" tabindex="0">1</span>' +
    '<span class="qa-mode-slash">/</span>' +
    '<span class="qa-mode-opt qa-mode-2" tabindex="0">2</span>' +
    '<span class="qa-mode-desc">1 for fixed # times, 2 for fixed end date</span>' +
    '</span>' +
    '</div>';

  var folderInput = _q(cardEl, 'qa-folder');
  var plusBtn = _q(cardEl, 'qa-plus-btn');
  var modeSelector = _q(cardEl, 'qa-mode-selector');
  var scheduleRow = _q(cardEl, 'qa-schedule-row-el');
  var modeField = _q(cardEl, 'qa-mode-field');
  var qaMode = 0;

  function updateColor() {
    var folderVal = folderInput.value.trim();
    var color = '#5f6368';
    if (folderVal) {
      var folder = resolveFolderInput(folderVal);
      if (folder && folder.color) color = folder.color;
    }
    cardEl.style.borderColor = color;
    cardEl.style.setProperty('--qa-border-color', color);
    _q(cardEl, 'qa-header').style.backgroundColor = color;
  }

  folderInput.addEventListener('input', updateColor);
  folderInput.addEventListener('change', updateColor);

  function collapseToAction() {
    qaMode = 0;
    modeSelector.style.display = 'none';
    scheduleRow.style.display = 'none';
    modeField.style.display = 'none';
    _q(cardEl, 'qa-header').textContent = 'Action';
    updateColor();
    plusBtn.textContent = '+';
  }

  function togglePlus() {
    if (qaMode > 0 || modeSelector.style.display !== 'none') {
      collapseToAction();
    } else {
      modeSelector.style.display = '';
      plusBtn.textContent = '\u2212';
      _q(cardEl, 'qa-mode-1').focus();
    }
  }
  plusBtn.addEventListener('click', togglePlus);
  plusBtn.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePlus(); }
  });

  function selectMode(mode) {
    qaMode = mode;
    modeSelector.style.display = 'none';
    scheduleRow.style.display = 'flex';
    modeField.style.display = '';
    if (mode === 1) {
      modeField.placeholder = '# Instances';
      modeField.type = 'number';
      modeField.min = '2';
    } else {
      modeField.placeholder = 'End day';
      modeField.type = 'text';
    }
    modeField.value = '';
    _q(cardEl, 'qa-header').textContent = 'Schedule';
    updateColor();
    _q(cardEl, 'qa-start-day').focus();
  }

  _q(cardEl, 'qa-mode-1').addEventListener('click', function() { selectMode(1); });
  _q(cardEl, 'qa-mode-2').addEventListener('click', function() { selectMode(2); });
  _q(cardEl, 'qa-mode-1').addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(1); } });
  _q(cardEl, 'qa-mode-2').addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(2); } });

  updateColor();

  var card = {
    type: 'action',
    el: cardEl,
    draftId: null,
    _onOverlayKeydown: function(e) {
      if (modeSelector.style.display !== 'none' && qaMode === 0) {
        if (e.key === '1') { e.preventDefault(); selectMode(1); return; }
        if (e.key === '2') { e.preventDefault(); selectMode(2); return; }
      }
    },
    onSubmit: function() { submitThisAction(); },
    onDismiss: function() {}
  };

  function submitThisAction() {
    var nameVal = _q(cardEl, 'qa-name').value.trim();
    var startVal = _q(cardEl, 'qa-start-dt').value.trim();
    var endVal = _q(cardEl, 'qa-end-dt').value.trim();
    var folderVal = _q(cardEl, 'qa-folder').value.trim();
    var isSchedule = scheduleRow && scheduleRow.style.display !== 'none';

    if (isSchedule) { submitActionSchedule(card, cardEl, nameVal, startVal, endVal, folderVal); return; }

    if (!nameVal) { alert('Name is required.'); _q(cardEl, 'qa-name').focus(); return; }

    var startDt = null;
    if (startVal) {
      var parsed = parseNaturalDate(startVal, '00:00');
      if (parsed) { startDt = localInputToUTC(parsed.date + 'T' + parsed.time); }
      else { startDt = localInputToUTC(startVal); }
    }
    if (!startDt) { alert('Could not parse start time. Try: "today 8:30 am", "tomorrow 3 pm", etc.'); _q(cardEl, 'qa-start-dt').focus(); return; }

    var endDt = null;
    if (endVal) {
      var parsedEnd = parseNaturalDate(endVal, '23:59');
      if (parsedEnd) { endDt = localInputToUTC(parsedEnd.date + 'T' + parsedEnd.time); }
      else { endDt = localInputToUTC(endVal); }
    }
    if (!endDt) { alert('Could not parse end time. Try: "today 10 am", "tomorrow 5 pm", etc.'); _q(cardEl, 'qa-end-dt').focus(); return; }

    var folder = folderVal ? resolveFolderInput(folderVal) : null;
    if (folderVal && !folder) { alert('Folder not found. Create it first or use its exact name.'); _q(cardEl, 'qa-folder').focus(); return; }
    var data = { name: nameVal, start_datetime: startDt, end_datetime: endDt, folder_id: folder ? folder.id : null, is_planned: false };

    var createFoldersThenAction = function() {
      fetch('/api/actions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() { CardStack.remove(card); refreshData(); })
        .catch(function(err) { alert(err.message || 'Failed to create action.'); });
    };

    createFoldersThenAction();
  }

  return card;
}

function submitActionSchedule(card, cardEl, nameVal, startVal, endVal, folderVal) {
  if (!nameVal) { alert('Name is required.'); _q(cardEl, 'qa-name').focus(); return; }

  var startDayVal = _q(cardEl, 'qa-start-day').value.trim();
  var patternVal = _q(cardEl, 'qa-pattern').value.trim();
  var modeFieldEl = _q(cardEl, 'qa-mode-field');
  var modeFieldVal = modeFieldEl.value.trim();
  var isEndDateMode = modeFieldEl.placeholder === 'End day';

  // Parse start/end as times only (for schedule templates)
  var startTime = null;
  if (startVal) {
    var sp = parseNaturalDate(startVal, '00:00');
    startTime = sp ? sp.time : '00:00';
  }

  var endTime = null;
  if (endVal) {
    var ep2 = parseNaturalDate(endVal, '23:59');
    endTime = ep2 ? ep2.time : '23:59';
  }

  var firstDay = null;
  if (startDayVal) {
    var sdp = parseNaturalDate(startDayVal, '00:00');
    if (sdp) { firstDay = sdp.date; }
    else {
      var sd = new Date(startDayVal + 'T00:00:00');
      if (!isNaN(sd.getTime())) firstDay = fmtDate(sd);
    }
  }
  if (!firstDay) { alert('Could not parse start day.'); _q(cardEl, 'qa-start-day').focus(); return; }

  var pattern = parsePatternInput(patternVal);
  if (!pattern) { alert('Could not parse pattern. Try: "daily", "weekdays", "every 2 days", "every mon wed fri".'); _q(cardEl, 'qa-pattern').focus(); return; }

  var scheduleData = {
    name: nameVal, start_time: startTime || '08:00', end_time: endTime || '09:00',
    first_day: firstDay, pattern: pattern, folder_id: null
  };

  if (isEndDateMode) {
    if (!modeFieldVal) { alert('End day is required.'); modeFieldEl.focus(); return; }
    var edp = parseNaturalDate(modeFieldVal, '00:00');
    var endDay = null;
    if (edp) { endDay = edp.date; }
    else { var ed = new Date(modeFieldVal + 'T00:00:00'); if (!isNaN(ed.getTime())) endDay = fmtDate(ed); }
    if (!endDay) { alert('Could not parse end day.'); modeFieldEl.focus(); return; }
    scheduleData.end_date = endDay;
  } else {
    var instVal = parseInt(modeFieldVal);
    if (!instVal || instVal < 2) { instVal = computeMaxInstancesClientSide(firstDay, pattern); }
    scheduleData.max_instances = instVal;
  }

  var scheduleFolder = folderVal ? resolveFolderInput(folderVal) : null;
  if (folderVal && !scheduleFolder) { alert('Folder not found. Create it first or use its exact name.'); _q(cardEl, 'qa-folder').focus(); return; }
  scheduleData.folder_id = scheduleFolder ? scheduleFolder.id : null;

  var createSchedule = function() {
    fetch('/api/schedules', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(scheduleData)})
      .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
      .then(function() { CardStack.remove(card); refreshData(); })
      .catch(function(err) { alert(err.message || 'Failed to create schedule.'); });
  };

  createSchedule();
}

window.openActionAdd = function() {
  CardStack.push(createActionCard());
};

window.manifestAction = function(actionId) {
  fetch('/api/actions/' + actionId + '/manifest', { method: 'POST' })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); });
      return r.json();
    })
    .then(function() { refreshData(); })
    .catch(function(err) { alert(err.message || 'Cannot manifest action.'); });
};

window.deleteAction = function(actionId) {
  if (!confirm('Delete this action?')) return;
  fetch('/api/actions/' + actionId, { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function() { refreshData(); });
};

// === NoteAdd Factory ===
function createNoteAddCard(existingNote) {
  var editingNoteId = existingNote ? existingNote.id : null;
  var draftId = null;
  var draftSaveTimer = null;

  var cardEl = document.createElement('div');
  cardEl.className = 'quickadd-card';
  cardEl.innerHTML =
    '<div class="quickadd-header na-header">Note</div>' +
    '<div class="quickadd-body">' +
    '<input class="quickadd-input na-name" placeholder="Name" autocomplete="off">' +
    '<div class="noteadd-date-row">' +
      '<input class="noteadd-date-seg na-mm" placeholder="M" inputmode="numeric">' +
      '<span class="noteadd-date-sep">/</span>' +
      '<input class="noteadd-date-seg na-dd" placeholder="D" inputmode="numeric">' +
      '<span class="noteadd-date-sep">/</span>' +
      '<span class="noteadd-year-group"><span class="noteadd-date-prefix">20</span><input class="noteadd-date-seg noteadd-date-year na-yy" placeholder="YY" inputmode="numeric"></span>' +
    '</div>' +
    '<input class="quickadd-input qa-folder na-folder" placeholder="Folder" autocomplete="off">' +
    '</div>';

  var nameInput = _q(cardEl, 'na-name');
  var folderInput = _q(cardEl, 'na-folder');
  var mm = _q(cardEl, 'na-mm');
  var dd = _q(cardEl, 'na-dd');
  var yy = _q(cardEl, 'na-yy');

  function updateColor() {
    var folderVal = folderInput.value.trim();
    var color = DEFAULT_COLOR;
    if (folderVal) {
      var folder = resolveFolderInput(folderVal);
      if (folder && folder.color) color = folder.color;
    }
    cardEl.style.borderColor = color;
    cardEl.style.setProperty('--qa-border-color', color);
    _q(cardEl, 'na-header').style.backgroundColor = color;
  }

  folderInput.addEventListener('input', updateColor);
  folderInput.addEventListener('change', updateColor);

  // Smart auto-tab between date segments
  function filterNumeric(e) { e.target.value = e.target.value.replace(/[^0-9]/g, ''); }

  mm.addEventListener('input', function(e) {
    filterNumeric(e);
    var v = mm.value;
    if (v.length === 1) {
      var d = parseInt(v, 10);
      if (d >= 2) { dd.focus(); }
    } else if (v.length >= 2) {
      var first = v.charAt(0);
      var second = v.charAt(1);
      if (first === '1') {
        if (second === '0' || second === '1' || second === '2') {
          mm.value = v.slice(0, 2); dd.focus();
        } else {
          mm.value = first;
          if (!dd.value) {
            dd.value = second; dd.focus();
            var dayD = parseInt(second, 10);
            if (dayD >= 4) { yy.focus(); }
          } else { dd.focus(); }
        }
      } else if (first === '0') { mm.value = v.slice(0, 2); dd.focus(); }
      else { mm.value = first; dd.focus(); }
    }
  });
  dd.addEventListener('input', function(e) {
    filterNumeric(e);
    var v = dd.value;
    if (v.length === 1) { var d = parseInt(v, 10); if (d >= 4) { yy.focus(); } }
    else if (v.length >= 2) {
      var num = parseInt(v.slice(0, 2), 10);
      if (num >= 1 && num <= 31) { dd.value = v.slice(0, 2); yy.focus(); }
      else { dd.value = v.charAt(0); }
    }
  });
  yy.addEventListener('input', function(e) {
    filterNumeric(e);
    if (yy.value.length > 2) yy.value = yy.value.slice(0, 2);
  });
  dd.addEventListener('keydown', function(e) { if (e.key === 'Backspace' && dd.value === '') { mm.focus(); e.preventDefault(); } });
  yy.addEventListener('keydown', function(e) { if (e.key === 'Backspace' && yy.value === '') { dd.focus(); e.preventDefault(); } });

  // Populate if editing existing note
  if (existingNote) {
    nameInput.value = existingNote.name || '';
    if (existingNote.date) {
      var parts = existingNote.date.split('-');
      mm.value = parseInt(parts[1], 10) || '';
      dd.value = parseInt(parts[2], 10) || '';
      yy.value = parts[0] ? parts[0].slice(2) : '';
    }
    folderInput.value = existingNote.folder_id && getFolderById(existingNote.folder_id) ? getFolderLabel(getFolderById(existingNote.folder_id)) : '';
  }

  updateColor();

  // Draft auto-save for notes (not when editing existing)
  function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(saveNoteDraft, 2000);
  }
  var draftCreated = false;
  function saveNoteDraft() {
    if (!draftId) return;
    var nameVal = nameInput.value.trim() || '';
    if (!nameVal && !draftCreated) return; // don't create draft for empty content
    var data = {
      name: nameVal,
      draft_type: 'note',
      date: null,
      folder_id: resolveFolderInput(folderInput.value.trim()) ? resolveFolderInput(folderInput.value.trim()).id : null
    };
    var mmV = mm.value.trim(), ddV = dd.value.trim(), yyV = yy.value.trim();
    if (mmV && ddV && yyV) {
      data.date = (2000 + parseInt(yyV, 10)) + '-' + String(parseInt(mmV, 10)).padStart(2, '0') + '-' + String(parseInt(ddV, 10)).padStart(2, '0');
    }
    if (!draftCreated) {
      draftCreated = true;
      fetch('/api/drafts', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({draft_id: draftId}, data))});
    } else {
      fetch('/api/drafts/' + draftId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    }
  }

  if (existingNote && existingNote._draftId) {
    // Resuming a draft — reuse existing draft ID
    draftId = existingNote._draftId;
    draftCreated = true;
    editingNoteId = null; // it's a draft, not a saved note
    nameInput.addEventListener('input', scheduleDraftSave);
    mm.addEventListener('input', scheduleDraftSave);
    dd.addEventListener('input', scheduleDraftSave);
    yy.addEventListener('input', scheduleDraftSave);
    folderInput.addEventListener('input', scheduleDraftSave);
  } else if (!existingNote) {
    draftId = crypto.randomUUID ? crypto.randomUUID() : 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    nameInput.addEventListener('input', scheduleDraftSave);
    mm.addEventListener('input', scheduleDraftSave);
    dd.addEventListener('input', scheduleDraftSave);
    yy.addEventListener('input', scheduleDraftSave);
    folderInput.addEventListener('input', scheduleDraftSave);
  }

  var card = {
    type: 'note',
    el: cardEl,
    draftId: draftId,
    onSubmit: function() { submitThisNote(); },
    onDismiss: function() {
      if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; }
      if (draftId && draftCreated) {
        var hasContent = nameInput.value.trim();
        if (!hasContent) {
          fetch('/api/drafts/' + draftId, {method: 'DELETE'});
        } else {
          saveNoteDraft(); // final save
        }
      }
    }
  };

  function submitThisNote() {
    var nameVal = nameInput.value.trim();
    var mmVal = mm.value.trim();
    var ddVal = dd.value.trim();
    var yyVal = yy.value.trim();
    var folderVal = folderInput.value.trim();

    if (!nameVal) { alert('Name is required.'); nameInput.focus(); return; }
    if (!mmVal || !ddVal || !yyVal) { alert('Date is required (M/D/YY).'); return; }

    var mmI = parseInt(mmVal, 10);
    var ddI = parseInt(ddVal, 10);
    var yyyy = 2000 + parseInt(yyVal, 10);
    if (isNaN(mmI) || mmI < 1 || mmI > 12) { alert('Month must be 1-12.'); mm.focus(); return; }
    var maxDay = new Date(yyyy, mmI, 0).getDate();
    if (isNaN(ddI) || ddI < 1 || ddI > maxDay) { alert('Day must be 1-' + maxDay + ' for month ' + mmI + '.'); dd.focus(); return; }
    if (isNaN(yyyy)) { alert('Invalid year.'); yy.focus(); return; }

    var dateStr = yyyy + '-' + String(mmI).padStart(2, '0') + '-' + String(ddI).padStart(2, '0');
    var folder = folderVal ? resolveFolderInput(folderVal) : null;
    if (folderVal && !folder) { alert('Folder not found. Create it first or use its exact name.'); folderInput.focus(); return; }
    var noteData = { name: nameVal, date: dateStr, folder_id: folder ? folder.id : null };

    var saveNote = function() {
      var url = editingNoteId ? '/api/notes/' + editingNoteId : '/api/notes';
      var method = editingNoteId ? 'PUT' : 'POST';
      fetch(url, {method: method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(noteData)})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() {
          if (draftId) fetch('/api/drafts/' + draftId, {method: 'DELETE'});
          CardStack.remove(card);
          refreshData();
        })
        .catch(function(err) { alert(err.message || 'Failed to save note.'); });
    };

    saveNote();
  }

  return card;
}

window.openNoteAdd = function(existingNote) {
  CardStack.push(createNoteAddCard(existingNote));
};

window.closeNoteAdd = function() {
  CardStack.dismissTop();
};

window.deleteNote = function(noteId) {
  if (!confirm('Delete this note?')) return;
  fetch('/api/notes/' + noteId, {method: 'DELETE'})
    .then(function(r) { if (!r.ok) throw 0; return r.json(); })
    .then(function() { refreshData(); })
    .catch(function() { alert('Failed to delete note.'); });
};

window.editNote = function(noteId) {
  var note = prodNotes.find(function(n) { return n.id === noteId; });
  if (note) openNoteAdd(note);
};

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
