import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../services/defaultWorkspace";
import { createOrUpdateNodeFromMacro } from "../services/nodeService";
import { parseMacro } from "../utils/macroParser";

describe("node service", () => {
  it("parses subscription rates with every interval phrasing", () => {
    const parsed = parseMacro("<Gym; $8 every 2 weeks; Health>", "subscription");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const subscription = state.nodes.subscriptions[nodeId];

    expect(subscription.rate).toEqual({
      amount: 8,
      currency: "USD",
      intervalCount: 2,
      intervalUnit: "weeks"
    });
  });
});
