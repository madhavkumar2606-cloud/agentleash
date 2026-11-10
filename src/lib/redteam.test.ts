import { describe, expect, it } from "vitest";
import { getJob, score, startRedTeam, type Target } from "./redteam";

async function finished(target: Target) {
  const job = startRedTeam({ target, count: 6, generate: false });
  for (let i = 0; i < 100 && getJob(job.id)!.status !== "done"; i++) await new Promise((r) => setTimeout(r, 20));
  const done = getJob(job.id)!;
  expect(done.status).toBe("done");
  return { job: done, s: score(done) };
}

describe("AI red team (built-in attacks, scripted agent, mock PayPal)", () => {
  it("a weak agent falls for every attack, and Countersign stops every one", async () => {
    const { s } = await finished("naive");
    expect(s.total).toBe(6);
    expect(s.agentFell).toBe(6);
    expect(s.blocked + s.held).toBe(6);
    expect(s.leaked).toBe(0);
    expect(s.falseAlarms).toBe(0);
  });

  it("honest tickets get their fair refund, with no false alarms", async () => {
    const { job } = await finished("careful");
    const controls = job.results.filter((_r: unknown, i: number) => job.attacks[i].control);
    expect(controls).toHaveLength(2);
    for (const r of controls) expect(r.outcome).toBe("ok");
  });

  it("a careful agent still falls for some attacks; none get through Countersign", async () => {
    const { s, job } = await finished("careful");
    expect(s.agentFell).toBeGreaterThan(0);
    expect(s.agentFell).toBeLessThan(6);
    expect(s.leaked).toBe(0);
    expect(job.report?.fix.length).toBeGreaterThan(20);
  });
});
