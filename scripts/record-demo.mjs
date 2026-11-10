// Records the Countersign demo video by driving a real browser through the live site:
// landing page, the hijack, phone approval + PayPal payment ($79), the support agent with PayPal's MCP tools
// (a fair refund, then a poisoned ticket), the AI red team (attack, scorecard, report, harden and re-run),
// the kill switch, and asking the AG Grid audit log.
//
//   OWNER_PASSWORD=your-password npm run record-demo
//
// Options (environment variables):
//   DEMO_URL         site to record (default: the Render deployment)
//   OWNER_PASSWORD   dashboard password (required on a deployed site)
//   HIJACK_TRIES     how many times to run the hijack scenario until the real model falls for it (default 3)
//   CHROME_PATH      path to a Chrome/Chromium binary (default: your installed Google Chrome)
//   DEMO_PACE_MS     pause between AI runs, to stay under free Gemini limits (default 15000; 0 with billing on)
//   REDTEAM_COUNT    attacks per red-team run: 4, 6 or 8 (default 4)
//   REDTEAM_HARDEN   0 to skip "harden and re-run" (default: do it)
//   DEMO_HOLD        1 to turn on "Hold payments until delivery" before the $79 purchase
//
// Output: demo-recordings/<timestamp>/  raw.webm (the video), markers.json (what happened when, for editing),
// and full-resolution stills of the key moments. PayPal sandbox login is done by you, by hand: the script
// waits for it and marks that stretch so it can be cut out in editing.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.DEMO_URL || "https://agentleash-9xng.onrender.com").replace(/\/$/, "");
const PASSWORD = process.env.OWNER_PASSWORD || "";
const HIJACK_TRIES = Number(process.env.HIJACK_TRIES || 3);
// Pause between AI runs so the free Gemini tier's per-minute limit isn't hit mid-video (cut in editing).
const PACE_MS = Number(process.env.DEMO_PACE_MS ?? 15000);
// Red team: attacks per run (fewer = faster and gentler on free AI quotas), and whether to harden and re-run.
const REDTEAM_COUNT = Number(process.env.REDTEAM_COUNT || 4);
const HARDEN = process.env.REDTEAM_HARDEN !== "0";
// Turn on "Hold payments until delivery" before the $79 purchase (PayPal authorization, then capture on delivery).
const HOLD = process.env.DEMO_HOLD === "1";
let aiRuns = 0;
const W = 1440;
const H = 900;

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = join("demo-recordings", stamp);
mkdirSync(OUT, { recursive: true });

const markers = [];
let t0 = 0;
const mark = (name, extra = {}) => {
  const at = Date.now() - t0;
  markers.push({ name, atMs: at, ...extra });
  console.log(`[${(at / 1000).toFixed(1).padStart(6)}s] ${name}${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A visible cursor (Playwright's recordings don't show the real one).
const CURSOR = `
  (() => {
    if (window.__alCursor) return;
    window.__alCursor = true;
    const add = () => {
      const c = document.createElement('div');
      c.id = '__al_cursor';
      c.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transition:transform 60ms linear;';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5L9 21z" fill="#16150f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      document.addEventListener('mousemove', e => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
      document.addEventListener('mousedown', () => { c.firstChild.style.transform = 'scale(0.8)'; }, true);
      document.addEventListener('mouseup', () => { c.firstChild.style.transform = ''; }, true);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  })();`;

let mouse = { x: W / 2, y: H / 2 };

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element not visible");
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 20);
  await page.mouse.move(x, y, { steps: 25 });
  mouse = { x, y };
  await wait(250);
}

async function click(page, locator) {
  await moveTo(page, locator);
  await locator.click();
  await wait(300);
}

async function typeSlow(page, locator, text) {
  await click(page, locator);
  await locator.pressSequentially(text, { delay: 55 });
}

async function smoothScroll(page, toY, ms = 1500) {
  await page.evaluate(
    ([y, d]) =>
      new Promise((res) => {
        const start = window.scrollY;
        const t = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t) / d);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          window.scrollTo(0, start + (y - start) * e);
          if (k < 1) requestAnimationFrame(step);
          else res();
        };
        requestAnimationFrame(step);
      }),
    [toY, ms],
  );
}

async function scrollToEl(page, locator, offset = 90) {
  const y = await locator.evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY - off, offset);
  await smoothScroll(page, Math.max(0, y));
}

async function still(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function pace() {
  if (aiRuns++ > 0 && PACE_MS > 0) {
    mark("pace:start");
    await wait(PACE_MS);
    mark("pace:end");
  }
}

// Support tickets: the card's label turns into "Running…" while the agent works, then back.
async function runTicket(page, label) {
  await pace();
  await smoothScroll(page, 0, 700);
  const card = page.getByRole("button", { name: new RegExp(label) }).first();
  await click(page, card);
  mark(`run:${label}`);
  await page.getByText("Running…").first().waitFor({ timeout: 10_000 }).catch(() => {});
  await page.getByText("Running…").first().waitFor({ state: "hidden", timeout: 90_000 });
  await wait(900);
  mark(`verdict:${label}`);
}

// The trace animates in after the verdict, so wait for its closing note before reading it.
async function fellForTrap(page) {
  await page.getByText(/fell for the trap|resisted the trap/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  return (await page.getByText("The real model fell for the trap").count()) > 0;
}

// A red-team run: wait for it to start and finish (the launch button comes back), then show the scorecard.
async function runRedTeam(page, label) {
  await page.getByRole("button", { name: /Attacking|writing|Starting|report/ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.getByRole("button", { name: /Launch attacks/ }).waitFor({ timeout: 360_000 });
  mark(`${label}:done`);
  await smoothScroll(page, 0, 700);
  await wait(4500);
}

async function runScenario(page, label) {
  await pace();
  await smoothScroll(page, 0, 700);
  await click(page, page.getByRole("button", { name: new RegExp(label) }).first());
  mark(`run:${label}`);
  await page.getByText("Purchase check").first().waitFor({ timeout: 90_000 });
  await wait(900); // let the stamp land
  mark(`verdict:${label}`);
}

const browser = await chromium.launch({
  headless: false,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
  args: [`--window-size=${W},${H + 120}`],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
await context.addInitScript(CURSOR);
const page = await context.newPage();
t0 = Date.now();

try {
  // 1. Landing page: the scan and the stopped $35
  mark("landing");
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 120_000 });
  await page.mouse.move(mouse.x, mouse.y);
  await wait(4200);
  await still(page, "01-landing-hero");
  mark("landing:scroll");
  await smoothScroll(page, 760, 1800);
  await wait(2500);
  await smoothScroll(page, 1500, 1800);
  await wait(2500);
  await smoothScroll(page, 0, 1200);
  await wait(600);

  // 2. Into the dashboard
  await click(page, page.getByRole("link", { name: "Open the live demo" }).first());
  if (page.url().includes("/login")) {
    if (!PASSWORD) throw new Error("This site needs a login. Run with OWNER_PASSWORD=... npm run record-demo");
    mark("login");
    await typeSlow(page, page.locator("#pw"), PASSWORD);
    await click(page, page.getByRole("button", { name: "Log in" }));
  }
  await page.getByRole("tab", { name: "Shopping agent" }).waitFor({ timeout: 60_000 });
  const reset = page.getByRole("button", { name: "Reset demo" });
  await reset.click();
  await page.waitForTimeout(800);
  mark("dashboard");
  await moveTo(page, page.locator("#rules-summary"));
  await wait(2500);

  // Make sure the live AI agent is on
  const live = page.getByRole("checkbox", { name: /Live AI agent/ });
  if ((await live.count()) && !(await live.isChecked()) && (await live.isEnabled())) await click(page, live);

  // 3. Hijacked: retry until the real model falls for the trap (or tries run out)
  let fell = false;
  for (let i = 1; i <= HIJACK_TRIES && !fell; i++) {
    await runScenario(page, "Hijacked by a web page");
    fell = await fellForTrap(page);
    mark(fell ? "hijack:FELL" : "hijack:resisted", { attempt: i });
  }
  const hidden = page.getByText("Hidden text found").first();
  if (await hidden.count()) {
    await scrollToEl(page, hidden, 140);
    await wait(3000);
    await still(page, "03-hijack-hidden-text");
  }
  await scrollToEl(page, page.getByText("Purchase check").first());
  await wait(4500);
  await still(page, "04-hijack-verdict");
  mark("hijack:checks");
  await smoothScroll(page, (await page.evaluate(() => window.scrollY)) + 380, 1600);
  await wait(3000);

  // 4. Needs approval -> phone page -> PayPal (you log in and pay by hand)
  if (HOLD) {
    await smoothScroll(page, 0, 700);
    const hold = page.getByText("Hold payments until delivery");
    await scrollToEl(page, hold, 300);
    await click(page, hold);
    await wait(1500);
    mark("hold:on");
  }
  await runScenario(page, "Needs your approval");
  await scrollToEl(page, page.getByText("Purchase check").first());
  await wait(3000);
  await still(page, "05-review-on-hold");
  const review = page.getByRole("link", { name: "Review purchase" });
  await scrollToEl(page, review, 300);
  await click(page, review);
  await page.getByText("Your agent wants to spend").waitFor();
  mark("approve-page");
  await wait(3000);
  await still(page, "06-approve-page");
  // Countersign: pin this browser's key so it signs the approval (password needed if another device is pinned).
  const cs = page.getByTestId("countersign");
  await cs.waitFor({ timeout: 5000 }).catch(() => {});
  if ((await cs.getAttribute("data-state").catch(() => null)) !== "pinned" && (await cs.count())) {
    await scrollToEl(page, cs, 300);
    const pw = page.locator("#pin-pw");
    if (await pw.count()) await pw.fill(PASSWORD);
    await click(page, page.getByRole("button", { name: "Pin this browser" }));
    await page.locator('[data-state="pinned"]').waitFor({ timeout: 10000 });
    mark("countersign:pinned");
    await wait(2500);
  }
  await click(page, page.getByRole("button", { name: /Approve/ }));

  if (page.url().includes("/mock-paypal")) {
    // Mock mode (no PayPal keys): click through the clearly-labelled fake checkout.
    await page.getByText("Pay Now").waitFor();
    await wait(1500);
    await click(page, page.getByText("Pay Now"));
  } else {
    mark("paypal:manual-start");
    console.log("\n>>> Log in with your US sandbox BUYER account in the browser window and click Pay. Waiting up to 5 minutes...\n");
  }
  if (HOLD) {
    await page.getByText(/PayPal is holding/).first().waitFor({ timeout: 300_000 });
    mark("paypal:held");
    await wait(4000);
    await still(page, "07-held-by-paypal");
    await click(page, page.getByRole("button", { name: /It arrived/ }));
  }
  await page.getByText("Paid with PayPal").waitFor({ timeout: 300_000 });
  mark("paypal:paid");
  await wait(3500);
  await still(page, "07-paid");

  // 5. Merchant side: a support agent with PayPal's MCP tools, refunding the $79 payment just made
  await click(page, page.getByRole("link", { name: "Back to dashboard" }));
  await page.getByRole("tab", { name: /Support agent/ }).waitFor();
  await click(page, page.getByRole("tab", { name: /Support agent/ }));
  mark("support");
  await wait(2500);

  await runTicket(page, "Fair partial refund");
  await scrollToEl(page, page.getByText("Refund check").first());
  await wait(3500);
  await still(page, "08-support-partial-refunded");

  // Poisoned ticket: retry until the live model falls for the hidden $500 instruction (or tries run out)
  let took = false;
  for (let i = 1; i <= HIJACK_TRIES && !took; i++) {
    await runTicket(page, "Poisoned support ticket");
    took = await fellForTrap(page);
    mark(took ? "poisoned:FELL" : "poisoned:resisted", { attempt: i });
  }
  const tainted = page.getByText("Hidden text found").first();
  if (await tainted.count()) {
    await scrollToEl(page, tainted, 140);
    await wait(3000);
    await still(page, "09-poisoned-hidden-text");
  }
  await scrollToEl(page, page.getByText("Refund check").first());
  await wait(4500);
  await still(page, "10-poisoned-blocked");

  // 6. AI red team: Gemini attacks the support agent; Countersign checks every refund it tries
  await pace();
  await smoothScroll(page, 0, 700);
  await click(page, page.getByRole("tab", { name: "AI red team" }));
  mark("redteam");
  await wait(2500);
  const countSel = page.getByRole("combobox").first();
  if (await countSel.count()) await countSel.selectOption(String(REDTEAM_COUNT));
  await click(page, page.getByRole("button", { name: /Launch attacks/ }));
  mark("redteam:launch");
  await runRedTeam(page, "redteam");
  await still(page, "11-redteam-scorecard");
  // Open the first attack Countersign stopped
  const stopped = page.locator("details summary").filter({ hasText: /Blocked by Countersign|Held for your approval/ }).first();
  if (await stopped.count()) {
    await click(page, stopped);
    await wait(1200);
    await scrollToEl(page, stopped, 120);
    await wait(5000);
    await still(page, "12-redteam-attack-detail");
    mark("redteam:detail");
  }
  const report = page.getByText("Where your agent is weak");
  await scrollToEl(page, report, 160);
  await wait(5000);
  await still(page, "13-redteam-report");
  mark("redteam:report");
  const harden = page.getByRole("button", { name: /Harden the agent/ });
  if (HARDEN && (await harden.count())) {
    await pace();
    await click(page, harden);
    mark("redteam:harden");
    await runRedTeam(page, "hardened");
    await still(page, "14-redteam-hardened");
  }

  // 7. Kill switch: freeze every agent; even a fair refund is blocked
  await smoothScroll(page, 0, 700);
  await click(page, page.getByRole("button", { name: "Freeze all agents" }));
  await page.getByText("Every agent is frozen.").waitFor();
  mark("freeze");
  await wait(2500);
  await click(page, page.getByRole("tab", { name: /Support agent/ }));
  await runTicket(page, "Fair partial refund");
  await scrollToEl(page, page.getByText("Refund check").first());
  await wait(4000);
  await still(page, "15-frozen-blocked");
  mark("freeze:blocked");
  await smoothScroll(page, 0, 700);
  await click(page, page.getByRole("button", { name: "Unfreeze" }));
  mark("unfreeze");
  await wait(1500);

  // 8. Ask the audit log (AG Grid)
  const audit = page.getByText("Audit log", { exact: true });
  await scrollToEl(page, audit, 120);
  mark("audit-log");
  await wait(2500);
  await click(page, page.getByRole("button", { name: "Blocked refunds" }));
  await wait(3500);
  await still(page, "16-audit-blocked-refunds");
  mark("audit:asked");
  await click(page, page.getByRole("button", { name: "What did hidden instructions try to do?" }));
  await wait(4000);
  await still(page, "17-audit-hidden");
  mark("end");
} catch (err) {
  mark("error", { message: String(err?.message ?? err) });
  console.error("\nRecording stopped early:", err?.message ?? err);
  await still(page, "error").catch(() => {});
} finally {
  const video = page.video();
  await context.close();
  if (video) {
    try {
      await video.saveAs(join(OUT, "raw.webm"));
      await video.delete();
    } catch (e) {
      console.error("Could not save the video. Run `npx playwright install ffmpeg` and try again.", e?.message ?? e);
    }
  }
  await browser.close();
  writeFileSync(join(OUT, "markers.json"), JSON.stringify({ base: BASE, recordedAt: stamp, markers }, null, 2));
  console.log(`\nSaved to ${OUT}/ : raw.webm, markers.json and stills. Upload that folder (zipped) for editing.`);
}
