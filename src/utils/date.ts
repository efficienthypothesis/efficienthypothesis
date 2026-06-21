export function getLocalDateParts(date = new Date()): { year: number; month: number; day: number } {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
}

export function getSevenDayWindow(date = new Date()): Date[] {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    return next;
  });
}

export function formatMonthName(date = new Date()): string {
  return date.toLocaleDateString(undefined, { month: "long" });
}

export function parseLocalDateTimeToUtc(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();
  const lower = value.toLowerCase();
  const now = new Date();

  if (lower === "today" || lower === "tomorrow") {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    if (lower === "tomorrow") date.setDate(date.getDate() + 1);
    return date.toISOString();
  }

  const relativeMatch = lower.match(/^(today|tomorrow)\s+(.+)$/);
  if (relativeMatch) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    if (relativeMatch[1] === "tomorrow") date.setDate(date.getDate() + 1);
    const time = parseTime(relativeMatch[2]);
    if (time) {
      date.setHours(time.hour, time.minute, 0, 0);
      return date.toISOString();
    }
  }

  const usMatch = value.match(
    /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(.+))?$/
  );
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const yearRaw = usMatch[3];
    const year = yearRaw
      ? yearRaw.length === 2
        ? 2000 + Number(yearRaw)
        : Number(yearRaw)
      : now.getFullYear();
    const time = parseTime(usMatch[4] || null);
    const date = new Date(year, month - 1, day, time?.hour ?? 0, time?.minute ?? 0, 0, 0);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

export function parseTime(raw: string | null): { hour: number; minute: number } | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3];
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function hasExplicitTime(raw: string | null): boolean {
  if (!raw || !raw.trim()) return false;
  const value = raw.trim();
  const lower = value.toLowerCase();
  const relativeMatch = lower.match(/^(today|tomorrow)\s+(.+)$/);
  if (relativeMatch) return Boolean(parseTime(relativeMatch[2]));

  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(.+))?$/);
  if (usMatch) return Boolean(parseTime(usMatch[4] || null));

  return /\b\d{1,2}:\d{2}\b/.test(value) || /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(value);
}

export function formatDateTimeLocal(iso: string | null, includeTime = true): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const dateOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric"
  };
  if (!includeTime) return date.toLocaleDateString(undefined, dateOptions);

  return date.toLocaleString(undefined, {
    ...dateOptions,
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatTimeLocal(raw: string | null): string {
  if (!raw) return "";
  const parsed = parseTime(raw);
  if (!parsed) return raw;
  const date = new Date();
  date.setHours(parsed.hour, parsed.minute, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
