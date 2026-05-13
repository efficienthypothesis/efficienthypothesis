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
