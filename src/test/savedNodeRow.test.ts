import { describe, expect, it } from "vitest";
import { formatNameField, getNotePreviewLines } from "../components/SavedNodeRow";

describe("saved node row", () => {
  it("splits semicolon and newline separated notes into preview lines", () => {
    expect(getNotePreviewLines("autopay enabled; shared line\nrenewal warning; receipt saved")).toEqual([
      "autopay enabled",
      "shared line",
      "renewal warning",
      "receipt saved"
    ]);
  });

  it("renders comma separated saved-row names on separate lines", () => {
    expect(formatNameField("Wikiabler, Problemanalytics, Efficient Hypothesis")).toBe(
      "Wikiabler\nProblemanalytics\nEfficient Hypothesis"
    );
    expect(formatNameField("Driving Exam")).toBe("Driving Exam");
  });
});
