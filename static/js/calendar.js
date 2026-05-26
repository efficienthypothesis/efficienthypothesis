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
