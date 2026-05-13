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
      var noteData = {name: draft.name||'', date: draft.date||null, group: draft.group||null, _draftId: draft.draft_id};
      openNoteAdd(noteData);
    } else if(draft.draft_type==='group') {
      var groupData = {path: draft.name ? '/'+draft.name : '', color: draft.color||DEFAULT_COLOR, _draftId: draft.draft_id};
      openGroupModal(groupData);
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
