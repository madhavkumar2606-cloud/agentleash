// Runs once when the server starts: release stale holds every 15 minutes even if nobody has the dashboard open.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { autoReleaseStaleHolds } = await import("./lib/orchestrator");
  setInterval(() => autoReleaseStaleHolds().catch(() => undefined), 15 * 60 * 1000).unref?.();
}
