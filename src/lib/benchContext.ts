// Per-run overrides for Countersign Bench, scoped with AsyncLocalStorage so a benchmark running on a
// live server never touches real requests: an ablation can switch the AI off, and refund cases look up
// a fixed capture fixture instead of PayPal, so results are reproducible.

import { AsyncLocalStorage } from "node:async_hooks";
import type { CaptureInfo } from "./paypal";

export interface BenchScope {
  noLlm?: boolean;
  captures?: Map<string, CaptureInfo>;
}

export const benchScope = new AsyncLocalStorage<BenchScope>();
