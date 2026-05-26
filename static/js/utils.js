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
function getRootTasks(tasks) { return tasks.filter(t => !t.parent_id); }
function getVisibleRoots(tasks) {
  var visibleIds = new Set(tasks.map(function(t) { return t.task_id; }));
  return tasks.filter(function(t) {
    return !t.parent_id || !visibleIds.has(t.parent_id);
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
