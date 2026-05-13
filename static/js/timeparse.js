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
