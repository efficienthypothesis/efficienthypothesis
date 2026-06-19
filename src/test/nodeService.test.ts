import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../services/defaultWorkspace";
import { createOrUpdateNodeFromMacro } from "../services/nodeService";
import { parseMacro } from "../utils/macroParser";
import { formatSubscriptionRateDisplay } from "../utils/subscriptions";

describe("node service", () => {
  it("parses subscription rates from four comma-separated values", () => {
    const parsed = parseMacro("<Gym; 8, USD, 2, weeks; Health>", "subscription");
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

  it("keeps symbol currencies and normalizes singular interval units", () => {
    const parsed = parseMacro("<News; 8, $, 1, month; Reading>", "subscription");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const subscription = state.nodes.subscriptions[nodeId];

    expect(subscription.rate).toEqual({
      amount: 8,
      currency: "$",
      intervalCount: 1,
      intervalUnit: "months"
    });
  });

  it("formats subscription rates for compact saved rows", () => {
    expect(
      formatSubscriptionRateDisplay({
        amount: 51.27,
        currency: "USD",
        intervalCount: 1,
        intervalUnit: "months"
      })
    ).toBe("$51.27/month");

    expect(
      formatSubscriptionRateDisplay({
        amount: 8,
        currency: "USD",
        intervalCount: 4,
        intervalUnit: "weeks"
      })
    ).toBe("$8/4 weeks");
  });
});
