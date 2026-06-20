import { describe, expect, it } from "vitest";
import { getNotePreviewLines } from "../components/SavedNodeRow";

describe("saved node row", () => {
  it("splits semicolon and newline separated notes into preview lines", () => {
    expect(getNotePreviewLines("autopay enabled; shared line\nrenewal warning; receipt saved")).toEqual([
      "autopay enabled",
      "shared line",
      "renewal warning",
      "receipt saved"
    ]);
  });
});
