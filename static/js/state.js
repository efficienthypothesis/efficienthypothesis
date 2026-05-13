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
let prodFolders = []; // folder objects [{path, name, color}]
let prodNotes = []; // note objects [{id, name, date, folder, created_at}]
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
let projectsFocusPath = null; // null = root, or a folder path like '/SCHOOL'
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
