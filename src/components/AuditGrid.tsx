"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi } from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { useMemo, useRef, useState } from "react";
import type { AuditPlan } from "@/lib/auditQuery";
import type { Decision, Verdict } from "@/lib/types";
import { PAYMENT_TEXT, PaymentChip, usd, VerdictBadge } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

const VERDICT_LABEL: Record<Verdict, string> = { ALLOW: "Allowed", REVIEW: "Needs approval", BLOCK: "Blocked" };

interface Row {
  id: string;
  time: Date;
  kind: "Purchase" | "Refund" | "PayPal action";
  agent: string;
  action: string;
  merchant: string;
  amount: number;
  verdict: string;
  verdictCode: Verdict;
  payment: string;
  d: Decision;
  risk: number;
  why: string;
}

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  fontSize: 13,
  backgroundColor: "#fffdf8",
  foregroundColor: "#16150f",
  headerBackgroundColor: "#fffdf8",
  headerTextColor: "#6b675c",
  headerFontWeight: 500,
  borderColor: "#e3dfd3",
  rowBorder: { color: "#e3dfd3" },
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  accentColor: "#16150f",
  rowHoverColor: "#f6f4ef",
  selectedRowBackgroundColor: "#efebff",
  cellHorizontalPadding: 10,
  spacing: 6,
});

const EXAMPLES = ["Blocked refunds", "What did hidden instructions try to do?", "Purchases over $50, biggest first", "What's waiting for my approval?"];

export default function AuditGrid({ decisions }: { decisions: Decision[] }) {
  const api = useRef<GridApi<Row>>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [plan, setPlan] = useState<AuditPlan>();

  const rows = useMemo<Row[]>(
    () =>
      decisions.map((d) => ({
        id: d.id,
        time: new Date(d.createdAt),
        kind: d.toolCall ? (d.toolCall.tool === "create_refund" ? "Refund" : "PayPal action") : "Purchase",
        agent: d.proposal.agentId,
        action: d.toolCall ? d.proposal.title : `${d.proposal.quantity} × ${d.proposal.title}`,
        merchant: d.toolCall ? `PayPal MCP · ${d.toolCall.tool}` : d.proposal.merchantName,
        amount: d.amount,
        verdict: VERDICT_LABEL[d.verdict],
        verdictCode: d.verdict,
        payment: PAYMENT_TEXT[d.payment.status],
        d,
        risk: d.riskScore,
        why: d.summary,
      })),
    [decisions],
  );

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        field: "time",
        headerName: "Time",
        width: 92,
        filter: "agDateColumnFilter",
        sort: "desc",
        valueFormatter: (p) => (p.value as Date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
        cellClass: "tabular-nums text-muted",
      },
      { field: "kind", headerName: "Type", width: 110, filter: "agTextColumnFilter", hide: true },
      {
        field: "action",
        headerName: "Action",
        flex: 2,
        minWidth: 150,
        filter: "agTextColumnFilter",
        autoHeight: true,
        wrapText: true,
        cellRenderer: (p: CustomCellRendererProps<Row>) => (
          <div className="py-2 leading-snug">
            <p className="font-medium">{p.data?.action}</p>
            <p className="text-xs text-muted">{p.data?.merchant}</p>
          </div>
        ),
      },
      { field: "amount", headerName: "Amount", width: 86, filter: "agNumberColumnFilter", type: "rightAligned", valueFormatter: (p) => usd(p.value), cellClass: "tabular-nums" },
      {
        field: "verdict",
        headerName: "Verdict",
        width: 156,
        filter: "agTextColumnFilter",
        cellRenderer: (p: CustomCellRendererProps<Row>) => p.data && <VerdictBadge verdict={p.data.verdictCode} />,
      },
      {
        field: "payment",
        headerName: "Payment",
        width: 162,
        filter: "agTextColumnFilter",
        cellRenderer: (p: CustomCellRendererProps<Row>) =>
          p.data &&
          (p.data.d.payment.status === "awaiting_owner" ? (
            <a href={`/approve/${p.data.id}`} className="text-xs font-medium text-review underline underline-offset-2">
              Review now
            </a>
          ) : (
            <PaymentChip status={p.data.d.payment.status} />
          )),
      },
      { field: "risk", headerName: "Risk", width: 84, filter: "agNumberColumnFilter", cellClass: "tabular-nums", hide: true },
      { field: "agent", headerName: "Agent", width: 150, filter: "agTextColumnFilter", hide: true },
            {
        field: "why",
        headerName: "Why",
        flex: 2,
        minWidth: 170,
        filter: "agTextColumnFilter",
        wrapText: true,
        autoHeight: true,
        cellRenderer: (p: CustomCellRendererProps<Row>) => <p className="py-2 text-xs leading-relaxed text-muted">{p.value}</p>,
      },
    ],
    [],
  );

  function apply(p: AuditPlan) {
    const a = api.current;
    if (!a) return;
    const model: Record<string, unknown> = {};
    for (const f of p.filters) {
      const numeric = f.column === "amount" || f.column === "risk";
      model[f.column] = numeric
        ? { filterType: "number", type: f.op === "contains" ? "equals" : f.op, filter: Number(f.value) }
        : { filterType: "text", type: f.op === "equals" ? "equals" : "contains", filter: String(f.value) };
    }
    a.setFilterModel(model);
    a.applyColumnState({
      state: p.sort ? [{ colId: p.sort.column, sort: p.sort.dir }] : [{ colId: "time", sort: "desc" }],
      defaultState: { sort: null },
    });
  }

  async function ask(q: string) {
    if (q.trim().length < 3) return;
    setQuestion(q);
    setAsking(true);
    try {
      const res = await fetch("/api/audit/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      if (!res.ok) throw new Error();
      const p: AuditPlan = await res.json();
      setPlan(p);
      apply(p);
    } catch {
      setPlan({ filters: [], sort: null, explanation: "Couldn't answer that just now. Try again.", by: "rules" });
    } finally {
      setAsking(false);
    }
  }

  function clear() {
    setPlan(undefined);
    setQuestion("");
    api.current?.setFilterModel(null);
    api.current?.applyColumnState({ state: [{ colId: "time", sort: "desc" }], defaultState: { sort: null } });
  }

  return (
    <section className="rounded-xl border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Audit log</h2>
        <p className="text-xs text-muted">Every purchase and refund any agent attempted · AG Grid</p>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="audit-q" className="sr-only">
          Ask your audit log
        </label>
        <input
          id="audit-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='Ask your audit log, e.g. "blocked refunds over $50"'
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:border-ink"
        />
        <button type="submit" disabled={asking || question.trim().length < 3} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50">
          {asking ? "Asking…" : "Ask"}
        </button>
        <div className="flex w-full flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => ask(x)} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:border-ink hover:text-ink">
              {x}
            </button>
          ))}
        </div>
      </form>
      {plan && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-paper/60 px-5 py-2 text-xs">
          <p>
            {plan.by === "ai" && <span className="mr-2 rounded bg-line/70 px-1.5 py-px text-[10px] font-semibold text-muted">AI</span>}
            {plan.explanation}
          </p>
          <button onClick={clear} className="font-medium text-muted underline underline-offset-2 hover:text-ink">
            Show everything
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">Nothing yet. Run a scenario and every attempt lands here.</p>
      ) : (
        <div className="audit-grid">
          <AgGridReact<Row>
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            getRowId={(p) => p.data.id}
            domLayout="autoHeight"
            defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: false }}
            onGridReady={(e) => {
              api.current = e.api;
              if (plan) apply(plan);
            }}
            pagination={rows.length > 15}
            paginationPageSize={15}
            paginationPageSizeSelector={false}
            suppressCellFocus
            animateRows
          />
        </div>
      )}
    </section>
  );
}
