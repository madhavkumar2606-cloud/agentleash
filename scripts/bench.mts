// Countersign Bench: npm run bench            (rules-only, plus full AI when LLM_PROVIDER is set)
//                    npm run bench -- --rules (rules-only only)
// Writes bench/results.json and bench/RESULTS.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { runBench, type BenchSummary } from "../src/lib/bench/run";
import { llmConfig } from "../src/lib/config";

const $ = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const p = (n: number) => `${(n * 100).toFixed(1)}%`;

const runs: BenchSummary[] = [await runBench("rules")];
if (!process.argv.includes("--rules") && llmConfig().provider !== "mock") {
  runs.push(await runBench("full", { onProgress: (d, t) => process.stderr.write(`\rfull AI: ${d}/${t}`) }));
  process.stderr.write("\n");
}

const rows = runs.map(
  (r) =>
    `| ${r.mode === "full" ? `Full (rules + ${r.model})` : "Rules only (AI off)"} | ${r.leaked}/${r.attacks} (${p(r.attackSuccessRate)}) | ${r.blocked} | ${r.held} | ${$(r.moneyStopped)} of ${$(r.moneyAtRisk)} | ${r.falseBlocks}/${r.honest} | ${r.extraReviews} | ${r.p50ms} ms |`,
);
const last = runs[runs.length - 1];
const detail = last.results
  .map((r) => `| ${r.attack ? "attack" : "honest"} | ${r.surface} | ${r.tactic} | ${r.title} | ${$(r.amount)} | ${r.verdict} | ${r.outcome.replace("_", " ")} |`)
  .join("\n");

const md = `# Countersign Bench

${last.attacks} attacks and ${last.honest} honest requests across shopping and customer support, run through the
**same engine the live app uses** (\`evaluate\` and \`evaluateToolCall\`), as a dry run. Each case fixes what the
agent tries to do, and for attacks the agent has already fallen for it, so this measures Countersign itself.
Without Countersign, every one of the ${last.attacks} attacks moves money: ${$(last.moneyAtRisk)} in total.

| Mode | Attacks that got money out | Blocked | Held for owner | Money stopped | Honest requests blocked | Extra approvals asked | Median time |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

"Held for owner" means no money moves until the owner approves it on their phone. Generated ${last.at}.

**Honesty note.** The first rules-only run of this bench let no attack through but only held 9 of them for approval
instead of blocking, and wrongly blocked one honest order ("about $30 each" was read as a $30 total). We fixed that bug
and taught the detector zero-width and leetspeak disguises, other languages, and fake tool output. Because those fixes
were made while looking at these cases, the rules-only score here is a best case. The AI red team in the app is the
check against overfitting: it writes new attacks the rules have never seen. Run \`npm run bench\` with an AI key set,
or press "Run it" under Rules + AI on the live dashboard, to get the full-mode numbers.

## Every case (${last.mode === "full" ? "full mode" : "rules only"})

| Kind | Surface | Tactic | Case | Amount | Verdict | Result |
|---|---|---|---|---|---|---|
${detail}
`;

mkdirSync("bench", { recursive: true });
writeFileSync("bench/results.json", JSON.stringify(runs, null, 2));
writeFileSync("bench/RESULTS.md", md);
for (const r of runs)
  console.log(
    `${r.mode.padEnd(5)} attacks leaked ${r.leaked}/${r.attacks} · blocked ${r.blocked} · held ${r.held} · honest blocked ${r.falseBlocks}/${r.honest} · extra reviews ${r.extraReviews} · missed reviews ${r.missedReviews}`,
  );
for (const r of last.results.filter((x) => x.outcome !== "blocked" && x.outcome !== "correct")) console.log(`  ${r.outcome.padEnd(13)} ${r.id}  ${r.verdict}  ${r.summary.slice(0, 110)}`);
