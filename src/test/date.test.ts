import { describe, expect, it } from "vitest";
import { formatDateTimeLocal, hasExplicitTime, parseLocalDateTimeToUtc } from "../utils/date";

describe("date utilities", () => {
  it("parses date-only task values at local midnight without inventing a time", () => {
    const iso = parseLocalDateTimeToUtc("7/1/2026");
    expect(iso).toBeTruthy();
    if (!iso) return;

    const date = new Date(iso);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
    expect(hasExplicitTime("7/1/2026")).toBe(false);
    expect(formatDateTimeLocal(iso, false)).not.toMatch(/:|AM|PM/i);
  });

  it("detects explicit task times", () => {
    expect(hasExplicitTime("7/1/2026 9:00 AM")).toBe(true);
    expect(hasExplicitTime("tomorrow 8pm")).toBe(true);
    expect(hasExplicitTime("tomorrow")).toBe(false);
  });
});
