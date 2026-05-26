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
  const children = (opts.allTasks || []).filter(c => c.task_id !== t.task_id && c.parent_id === t.task_id);
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
    const descendantIds = getTaskDescendantIds(taskId);
    const incompleteChildren = prodAllTasks.filter(c => descendantIds.indexOf(c.task_id) >= 0 && !c.end_datetime);
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
function onTopDragOver(e) { e.preventDefault();e.target.classList.add('drag-over'); }
function onTopDragLeave(e) { e.target.classList.remove('drag-over'); }
function onTopDrop(e) { e.preventDefault();e.target.classList.remove('drag-over');if(draggedTaskId)moveTask(draggedTaskId,null); }

function getTaskDescendantIds(taskId) {
  const descendants = [];
  const stack = [taskId];
  while (stack.length) {
    const current = stack.pop();
    prodAllTasks.forEach(t => {
      if (t.parent_id === current && descendants.indexOf(t.task_id) < 0) {
        descendants.push(t.task_id);
        stack.push(t.task_id);
      }
    });
  }
  return descendants;
}

function onCardDrop(e) {
  e.preventDefault();
  const tc=e.target.closest('.task-card');if(!tc||!draggedTaskId)return;
  tc.classList.remove('drag-over');
  const tid=tc.dataset.taskId;if(tid===draggedTaskId)return;
  if (getTaskDescendantIds(draggedTaskId).indexOf(tid) >= 0) return;
  moveTask(draggedTaskId, tid);
}

function moveTask(taskId, parentId) {
  fetch('/api/tasks/'+taskId+'/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent_id:parentId})})
    .then(r=>{if(!r.ok)throw 0;return r.json()})
    .then(()=>loadProductivityData())
    .catch(()=>alert('Failed.'));
}
