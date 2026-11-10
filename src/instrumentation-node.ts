// Node-only startup work (imported from instrumentation.ts): release stale holds every 15 minutes,
// even if nobody has the dashboard open.
import { autoReleaseStaleHolds } from "./lib/orchestrator";

setInterval(() => autoReleaseStaleHolds().catch(() => undefined), 15 * 60 * 1000).unref?.();
