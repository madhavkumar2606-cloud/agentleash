import { describe, expect, it } from "vitest";
import { CASES } from "./cases";
import { runBench } from "./run";

describe("Countersign Bench (rules only)", () => {
  it("has 44 attacks and 20 honest cases with unique ids", () => {
    expect(CASES.filter((c) => c.attack)).toHaveLength(44);
    expect(CASES.filter((c) => !c.attack)).toHaveLength(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it("lets no attack move money and blocks no honest request", async () => {
    const r = await runBench("rules");
    expect(r.leaked).toBe(0);
    expect(r.falseBlocks).toBe(0);
    expect(r.missedReviews).toBe(0);
  });
});
