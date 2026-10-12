import { describe, expect, it } from "vitest";
import { buildTakeaway } from "../server/analytics.js";

describe("buildTakeaway", () => {
  it("reports a positive fix and weighted overall shares", () => {
    const takeaway = buildTakeaway([
      {
        model: "gpt-5-6-terra",
        variant: "original",
        runs: 4,
        merchantPicks: 1,
        share: 0.25,
      },
      {
        model: "gpt-5-6-terra",
        variant: "fixed",
        runs: 4,
        merchantPicks: 3,
        share: 0.75,
      },
    ], []);

    expect(takeaway).toEqual({
      headline: "The fixed listing raised your share on gpt-5-6-terra from 25% to 75%.",
      bestFix: {
        model: "gpt-5-6-terra",
        originalShare: 0.25,
        fixedShare: 0.75,
        delta: 0.5,
      },
      topBreak: null,
      overall: { originalShare: 0.25, fixedShare: 0.75 },
    });
  });

  it("appends the most common checkout break using a stage label", () => {
    const takeaway = buildTakeaway([
      {
        model: "claude-sonnet-4-6",
        variant: "original",
        runs: 2,
        merchantPicks: 0,
        share: 0,
      },
      {
        model: "claude-sonnet-4-6",
        variant: "fixed",
        runs: 2,
        merchantPicks: 1,
        share: 0.5,
      },
    ], [
      {
        runId: "run-1",
        model: "claude-sonnet-4-6",
        variant: "original",
        stage: "approval_redirected",
        reason: "Approval redirect failed.",
      },
      {
        runId: "run-2",
        model: "claude-sonnet-4-6",
        variant: "fixed",
        stage: "approval_redirected",
        reason: "Approval redirect failed.",
      },
    ]);

    expect(takeaway.headline).toBe(
      "The fixed listing raised your share on claude-sonnet-4-6 from 0% to 50%. Checkout broke most often at PayPal approval for claude-sonnet-4-6 (2 runs).",
    );
    expect(takeaway.topBreak).toEqual({
      model: "claude-sonnet-4-6",
      stage: "approval_redirected",
      count: 2,
    });
  });

  it("reports no positive delta and does not append a break when none exists", () => {
    const takeaway = buildTakeaway([
      {
        model: "nova-pro",
        variant: "original",
        runs: 4,
        merchantPicks: 3,
        share: 0.75,
      },
      {
        model: "nova-pro",
        variant: "fixed",
        runs: 4,
        merchantPicks: 2,
        share: 0.5,
      },
    ], []);

    expect(takeaway.headline).toBe("Your original listing beat the fix on every model.");
    expect(takeaway.bestFix).toBeNull();
    expect(takeaway.topBreak).toBeNull();
    expect(takeaway.overall).toEqual({ originalShare: 0.75, fixedShare: 0.5 });
  });

  it("returns a null headline and empty insights without runs", () => {
    expect(buildTakeaway([], [])).toEqual({
      headline: null,
      bestFix: null,
      topBreak: null,
      overall: null,
    });
  });
});
