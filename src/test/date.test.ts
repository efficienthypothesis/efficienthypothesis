import { describe, expect, it } from "vitest";
import {
  formatDateTimeLocal,
  getTaskDateTone,
  hasExplicitTime,
  isSupportedTaskDateInput,
  parseLocalDateTimeToUtc
} from "../utils/date";

describe("date utilities", () => {
  it("parses date-only task values at local midnight without inventing a time", () => {
    const iso = parseLocalDateTimeToUtc("7/1/2026");
    expect(iso).toBeTruthy();
    if (!iso) return;

    const date = new Date(iso);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
    expect(hasExplicitTime("7/1/2026")).toBe(false);
    expect(formatDateTimeLocal(iso, false)).toBe("Jul 1");
  });

  it("detects explicit task times", () => {
    expect(hasExplicitTime("7/1/2026 9:00 AM")).toBe(true);
    expect(hasExplicitTime("7/1/2026, 9:00 AM")).toBe(true);
    expect(hasExplicitTime("tomorrow 8pm")).toBe(true);
    expect(hasExplicitTime("tomorrow")).toBe(false);
  });

  it("formats task dates and times on separate lines", () => {
    const iso = parseLocalDateTimeToUtc("5/5/2026, 2:00pm");
    expect(iso).toBeTruthy();
    if (!iso) return;

    expect(formatDateTimeLocal(iso, true)).toBe("May 5,\n2:00 PM");
  });

  it("leaves unsupported task date inputs for literal rendering", () => {
    expect(parseLocalDateTimeToUtc("May 5")).toBeNull();
    expect(parseLocalDateTimeToUtc("May 5 2:00 pm")).toBeNull();
    expect(parseLocalDateTimeToUtc("5/5/2026 garbage")).toBeNull();
    expect(isSupportedTaskDateInput("May 5")).toBe(false);
    expect(isSupportedTaskDateInput("5/5/2026, 2:00pm")).toBe(true);
  });

  it("classifies valid task dates relative to the current local date", () => {
    const today = new Date(2026, 5, 22, 9, 0, 0, 0);
    expect(getTaskDateTone(new Date(2026, 5, 21, 23, 30, 0, 0).toISOString(), today)).toBe(
      "recent-past"
    );
    expect(getTaskDateTone(new Date(2026, 5, 22, 0, 1, 0, 0).toISOString(), today)).toBe("today");
    expect(getTaskDateTone(new Date(2026, 5, 23, 0, 0, 0, 0).toISOString(), today)).toBe("future");
    expect(getTaskDateTone(new Date(2026, 5, 15, 23, 59, 0, 0).toISOString(), today)).toBe(
      "recent-past"
    );
    expect(getTaskDateTone(new Date(2026, 5, 29, 0, 0, 0, 0).toISOString(), today)).toBeNull();
    expect(getTaskDateTone("garbage", today)).toBeNull();
  });
});
