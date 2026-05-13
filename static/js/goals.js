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
