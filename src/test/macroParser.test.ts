import { describe, expect, it } from "vitest";
import {
  getDraftHint,
  inferNodeTypeFromSection,
  normalizeTagName,
  parseMacro
} from "../utils/macroParser";

describe("macro parser", () => {
  it("parses escaped delimiters", () => {
    const parsed = parseMacro("<Do this \\; not that; tomorrow; home>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.name).toBe("Do this ; not that");
    expect(parsed.primary).toBe("tomorrow");
    expect(parsed.tagName).toBe("home");
  });

  it("parses escaped angle brackets", () => {
    const parsed = parseMacro("<Use \\<example\\> syntax; tomorrow; coding>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.name).toBe("Use <example> syntax");
  });

  it("parses escaped comma in list fields", () => {
    const parsed = parseMacro("<AWS; username\\,admin, touch_id; coding>", "website");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.listValues).toEqual(["username,admin", "touch_id"]);
    expect(parsed.tagName).toBe("coding");
  });

  it("parses multiline task note", () => {
    const parsed = parseMacro(
      "<Put trash out; 6/17/2026 08:00pm; Home\nDad said to do this soon\nDon't Delay>",
      "task"
    );
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.name).toBe("Put trash out");
    expect(parsed.primary).toBe("6/17/2026 08:00pm");
    expect(parsed.tagName).toBe("Home");
    expect(parsed.note).toBe("Dad said to do this soon\nDon't Delay");
  });

  it("keeps missing fields as null", () => {
    const parsed = parseMacro("<Put trash out;;Home>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.primary).toBeNull();
    expect(parsed.tagName).toBe("Home");
  });

  it("treats extra subscription semicolon fields as note text", () => {
    const parsed = parseMacro(
      "<Verizon Phone Plan Simplicity; 51.27, USD, 1, month; Electronics; autopay enabled; shared line>",
      "subscription"
    );
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.name).toBe("Verizon Phone Plan Simplicity");
    expect(parsed.primary).toBe("51.27, USD, 1, month");
    expect(parsed.tagName).toBe("Electronics");
    expect(parsed.note).toBe("autopay enabled\nshared line");
  });

  it("shows note hints after subscription structured fields are exhausted", () => {
    expect(
      getDraftHint("<Verizon Phone Plan Simplicity; 51.27, USD, 1, month; Electronics;", "subscription")
    ).toBe("note");
    expect(
      getDraftHint("<Verizon Phone Plan Simplicity; 51.27, USD, 1, month; Electronics; extra;", "subscription")
    ).toBe("note");
  });

  it("uses semicolons across draft lines when calculating hints", () => {
    expect(
      getDraftHint(
        "<Verizon Phone Plan Simplicity; 51.27, USD, 1, month;\nElectronics;",
        "subscription"
      )
    ).toBe("note");
  });

  it("parses structured fields that continue on the next draft line", () => {
    const parsed = parseMacro(
      "<Verizon Phone Plan Simplicity; 51.27, USD, 1, month;\nElectronics;>",
      "subscription"
    );
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.primary).toBe("51.27, USD, 1, month");
    expect(parsed.tagName).toBe("Electronics");
    expect(parsed.note).toBeNull();
  });

  it("does not allow nested item creation", () => {
    const parsed = parseMacro("<Outer <Inner>; tomorrow; test>", "task");
    expect(parsed.valid).toBe(false);
    if (parsed.valid) return;
    expect(parsed.reason).toMatch(/Nested/);
  });

  it("infers node types from sections", () => {
    expect(inferNodeTypeFromSection("Tasks")).toBe("task");
    expect(inferNodeTypeFromSection("Websites")).toBe("website");
    expect(inferNodeTypeFromSection("Subscriptions")).toBe("subscription");
    expect(inferNodeTypeFromSection("Timetable")).toBe("task");
  });

  it("normalizes tag names", () => {
    expect(new Set(["Home", "home", "HOME"].map(normalizeTagName)).size).toBe(1);
  });
});
