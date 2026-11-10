// One Countersign Bench run at a time on the live server, polled by the dashboard.

import { runBench, type BenchMode, type BenchSummary } from "./run";

export interface BenchJob {
  id: string;
  mode: BenchMode;
  status: "running" | "done" | "error";
  done: number;
  total: number;
  startedAt: string;
  result?: BenchSummary;
  error?: string;
}

const g = globalThis as unknown as { __countersignBench?: { current?: BenchJob; last: Partial<Record<BenchMode, BenchSummary>> } };
const B = () => (g.__countersignBench ??= { last: {} });

export function benchState() {
  const b = B();
  return { current: b.current, last: b.last };
}

export function startBenchJob(mode: BenchMode): BenchJob {
  const b = B();
  if (b.current?.status === "running") return b.current;
  const job: BenchJob = { id: `bench_${Date.now().toString(36)}`, mode, status: "running", done: 0, total: 0, startedAt: new Date().toISOString() };
  b.current = job;
  runBench(mode, { onProgress: (d, t) => Object.assign(job, { done: d, total: t }) })
    .then((r) => {
      job.result = r;
      job.status = "done";
      b.last[mode] = r;
    })
    .catch((e) => Object.assign(job, { status: "error", error: (e as Error).message }));
  return job;
}
