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
