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
