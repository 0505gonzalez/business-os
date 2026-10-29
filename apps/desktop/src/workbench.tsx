import { WorkflowRules } from "./workflow-rules.js";
import { Modal } from "./modal.js";
import { Team } from "./team.js";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { ApiClient } from "../../../packages/api-client/src/index.js";
import { commandSchema } from "../../../packages/contracts/src/index.js";
import { Settings } from "./settings.js";
import { PlanningMapView } from "./planning-map.js";
import { Icon } from "./icons.js";
import { Sidebar, Avatar, PageHeader, EmptyState } from "./shell.js";
import { AgentPanel } from "./agent-panel.js";
import { WorkflowGraph, adrStages, featureStages } from "./workflow-graph.js";
type Row = Record<string, any>;
function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}
function paymentTone(state?: string) {
  const s = (state ?? "").toUpperCase();
  if (s === "SUCCEEDED") return "success";
  if (["FAILED", "CANCELED", "CANCELLED", "REVERSED"].includes(s))
    return "danger";
  if (s === "PENDING") return "warning";
  return "";
}
function spaced(value: string) {
  return value.replace(/([A-Z])/g, " $1").replaceAll("_", " ");
}
const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function sentence(value: string) {
  const text = value.trim();
  return text ? text[0]!.toUpperCase() + text.slice(1).toLowerCase() : text;
}
export function Workbench({
  client,
  workspaceId,
  userId,
  workspaceName,
  role,
  agentReady = true,
  agentConnectionError = "",
  workspacePicker,
  account,
}: {
  client: ApiClient;
  workspaceId: string;
  userId: string;
  workspaceName: string;
  role: string;
  agentReady?: boolean;
  agentConnectionError?: string;
  workspacePicker?: React.ReactNode;
  account?: React.ReactNode;
}) {
  const [page, setPage] = useState("Workflows"),
    [rows, setRows] = useState<Row[]>([]),
    [viewLoading, setViewLoading] = useState(true),
    [viewFailed, setViewFailed] = useState(false),
    [tasks, setTasks] = useState<Row[]>([]),
    [jobs, setJobs] = useState<Row[]>([]),
    [detail, setDetail] = useState<Row | null>(null),
    [selected, setSelected] = useState<string>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [chatBusy, setChatBusy] = useState(false),
    [query, setQuery] = useState(""),
    [area, setArea] = useState("temporal"),
    [creating, setCreating] = useState(false),
    [kind, setKind] = useState("adr"),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [answer, setAnswer] = useState(""),
    [task, setTask] = useState<Row | null>(null),
    [versions, setVersions] = useState<Row[]>([]),
    [activity, setActivity] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState(false),
    [messages, setMessages] = useState<{ role: string; text: string }[]>([]),
    [prompt, setPrompt] = useState(""),
    [stream, setStream] = useState(""),
    [status, setStatus] = useState("Idle"),
    [guiding, setGuiding] = useState(true),
    [guided, setGuided] = useState(false);
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [quick, setQuick] = useState("");
  const [paymentRows, setPaymentRows] = useState<Row[]>([]);
  const [paymentState, setPaymentState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [paymentError, setPaymentError] = useState("");
  const [paymentAttempt, setPaymentAttempt] = useState(0);
  const chatMessages = useRef<HTMLDivElement>(null);
  const followChat = useRef(true);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = chatMessages.current;
    if (node && followChat.current) node.scrollTop = node.scrollHeight;
  }, [messages, stream, expanded]);
  const base = `/${workspaceId}`;
  const visibleRows = page === "Payments" ? paymentRows : rows;
  const currentView = useRef({ base, page, selected, area, query });
  currentView.current = { base, page, selected, area, query };
  useEffect(() => {
    if (page !== "Payments") {
      setPaymentState("loading");
      return;
    }
    let active = true;
    setPaymentState("loading");
    setPaymentRows([]);
    setPaymentError("");
    void client
      .request<Row[]>(`${base}/payments?refresh=true`)
      .then((data) => {
        if (active) {
          setPaymentRows(data);
          setPaymentState("ready");
        }
      })
      .catch((e) => {
        if (active) {
          setPaymentError(e.message);
          setPaymentState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [client, base, page, paymentAttempt]);
  useEffect(() => {
    setViewLoading(true);
    setViewFailed(false);
  }, [base, page, area, query]);
  const load = useCallback(async () => {
    const stillHere = () =>
      Object.entries({ base, page, selected, area, query }).every(
        ([key, value]) =>
          currentView.current[key as keyof typeof currentView.current] ===
          value,
      );
    const [t, j, a] = await Promise.all([
      client.request<Row[]>(`${base}/tasks`),
      client.request<Row[]>(`${base}/jobs`),
      client.request<Row[]>(`${base}/activity`),
    ]);
    if (!stillHere()) return;
    setTasks(t);
    setJobs(j);
    setActivity(a);
    if (page === "Settings" || page === "Team") return;
    const path =
      page === "Workflows"
        ? "workflows"
        : page === "Payments"
          ? "payments"
          : `memory?area=${area}&q=${encodeURIComponent(query)}`;
    if (page !== "Payments") {
      const data = await client.request<Row[]>(`${base}/${path}`);
      if (!stillHere()) return;
      setRows(data);
      setViewLoading(false);
      setViewFailed(false);
    }
    if (selected) {
      const section =
        page === "Workflows"
          ? "workflows"
          : page === "Payments"
            ? "payments"
            : "memory";
      const data = await client.request(
        `${base}/${section}/${encodeURIComponent(selected)}`,
      );
      if (stillHere()) setDetail(data);
    }
  }, [client, base, page, selected, area, query]);
  useEffect(() => {
    let active = true;
    const update = () =>
      void load().catch((e) => {
        if (active) {
          setError(e.message);
          setViewLoading(false);
          setViewFailed(true);
        }
      });
    update();
    const timer = setInterval(update, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    void window.businessOS?.context({ page, id: selected });
  }, [page, selected]);
  useEffect(
    () =>
      window.businessOS?.onEvent((event) => {
        if (event.type === "text") setStream((s) => s + event.text);
        if (event.type === "status") setStatus(event.text ?? "Idle");
        if (event.type === "error") {
          setError(event.text ?? "Agent error");
          setStatus("Needs attention");
        }
        if (event.type === "command" && guiding) {
          const cmd = commandSchema.parse(event.command);
          if (cmd.type === "navigate") {
            setPage(cmd.page);
            setRows([]);
            setSelected(cmd.id);
            setDetail(null);
            setGuided(true);
          }
        }
      }),
    [guiding],
  );
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: string) {
    setPage(next);
    setRows([]);
    setSelected(undefined);
    setDetail(null);
    setVersions([]);
    setGuided(false);
  }
  function open(id: string) {
    setSelected(id);
    setDetail(null);
    setVersions([]);
  }
  function close() {
    setSelected(undefined);
    setDetail(null);
  }
  async function send(message?: string) {
    const text = message ?? prompt;
    if (!text.trim() || !agentReady || chatBusy) return;
    followChat.current = true;
    setChatBusy(true);
    setPrompt("");
    setMessages((m) => [...m, { role: "you", text }]);
    setStream("");
    setError("");
    try {
      if (!window.businessOS)
        throw new Error("The agent runs in the desktop application");
      const response = await window.businessOS.chat(text);
      setMessages((m) => [...m, { role: "agent", text: response.text }]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStream("");
      setChatBusy(false);
    }
  }
  /* While the agent runs, the pill reports its work ahead of anything else. */
  const pill = !agentReady
    ? "Connecting agent…"
    : status !== "Idle" && status !== "Paused"
      ? status
      : chatBusy
        ? "Working…"
        : tasks.length
          ? `Needs you: ${tasks.length}`
          : status === "Paused"
            ? "Paused"
            : jobs.some((j) => j.status === "failed")
              ? "Needs attention"
              : jobs.length
                ? "Work queued"
                : "Agent";
  const detailTitle = detail
    ? (detail.input?.title ?? detail.title ?? detail.id)
    : "";
  const stages = detail?.kind === "adr" ? adrStages : featureStages;
  const stageIndex = detail ? stages.indexOf(detail.stage) : -1;
  useEffect(() => {
    if (detail && page === "Workflows" && view === "canvas")
      detailRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  }, [detail?.id, page, view]);
  const detailCard = detail && (
    <article className="detail" ref={detailRef}>
      <div className="detail-top">
        <button className="btn ghost sm" onClick={close}>
          <Icon name="arrow-left" size={16} />
          Close
        </button>
        {page === "Memory" && (
          <span className="tag">
            {sentence(detail.area ?? "")} · Revision {detail.revision}
          </span>
        )}
        {page === "Workflows" && (
          <span className="tag">
            {detail.kind === "adr" ? "ADR review" : "Feature planning"}
          </span>
        )}
      </div>
      <h2>{detailTitle}</h2>
      {page === "Workflows" ? (
        <>
          {detail.error && (
            <div className="setup-notice">
              <Icon name="alert" size={18} />
              <div>
                <strong>Needs attention</strong>
                <p>{detail.error}</p>
              </div>
            </div>
          )}
          <div className="stages" aria-label="Workflow stages">
            {stages.map((stage, i) => (
              <span
                key={stage}
                className={
                  i < stageIndex
                    ? "done"
                    : stage === detail.stage
                      ? "current"
                      : ""
                }
              >
                {i < stageIndex && (
                  <Icon name="check" size={12} strokeWidth={2.5} />
                )}
                {sentence(spaced(stage))}
              </span>
            ))}
          </div>
          <div className="prose">
            {detail.snapshot?.body ?? detail.input?.body}
          </div>
          {detail.snapshot?.map && (
            <PlanningMapView map={detail.snapshot.map} />
          )}
          <WorkflowRules
            key={detail.id}
            client={client}
            base={`${base}/workflows/${detail.id}`}
            editable={
              detail.stage !== "completed" &&
              (role === "owner" || detail.owner_id === userId)
            }
            act={act}
          />
          <h3>
            <Icon name="inbox" size={16} />
            Tasks
          </h3>
          {!detail.tasks?.length && <p className="muted">No tasks yet.</p>}
          <div className="row-list">
            {detail.tasks?.map((t: Row) => (
              <div className="row-item" key={t.id}>
                <span>{t.title}</span>
                <span className="tag outline">
                  {t.assignee_id === userId ? "You" : t.assignee_id}
                </span>
                <span className="tag">{spaced(t.status ?? "")}</span>
              </div>
            ))}
          </div>
          <h3>
            <Icon name="sparkles" size={16} />
            Agent work
          </h3>
          {!detail.jobs?.length && <p className="muted">No agent work yet.</p>}
          <div className="row-list">
            {detail.jobs?.map((j: Row) => (
              <div className="row-item" key={j.id}>
                <span>{spaced(j.action ?? "")}</span>
                <span
                  className={
                    "tag " +
                    (j.status === "failed"
                      ? "danger"
                      : j.status === "completed"
                        ? "success"
                        : "")
                  }
                >
                  {spaced(j.status ?? "")}
                </span>
                {j.status === "failed" && (
                  <button
                    className="btn sm"
                    onClick={() =>
                      void act(() =>
                        client.request(
                          `${base}/jobs/${j.id}/retry`,
                          "POST",
                          {},
                        ),
                      )
                    }
                  >
                    Retry
                  </button>
                )}
                {j.error && <span className="error-text">{j.error}</span>}
              </div>
            ))}
          </div>
        </>
      ) : page === "Memory" ? (
        <>
          <div className="prose">{detail.body}</div>
          {detail.data?.kind === "prototype" && detail.body.includes("<") && (
            <iframe
              title="Prototype preview"
              sandbox=""
              srcDoc={detail.body.replace(/^```html\s*|\s*```$/g, "")}
            />
          )}
          {detail.approvals?.length > 0 && (
            <p className="muted">
              {detail.approvals
                .map((a: Row) => `Approved by ${a.userId} (${a.role})`)
                .join(", ")}
            </p>
          )}
          <div className="actions" style={{ justifyContent: "start" }}>
            <button
              className="btn"
              onClick={() =>
                void act(async () =>
                  setVersions(
                    await client.request(`${base}/memory/${selected}/history`),
                  ),
                )
              }
            >
              <Icon name="history" size={15} />
              Revision history
            </button>
          </div>
          {versions.map((v) => (
            <details key={v.revision}>
              <summary>
                Revision {v.revision} · {sentence(v.area ?? "")}
              </summary>
              <div className="prose">{v.body}</div>
            </details>
          ))}
        </>
      ) : (
        <dl>
          {Object.entries(detail)
            .filter(([, v]) => typeof v !== "object")
            .map(([k, v]) => (
              <React.Fragment key={k}>
                <div>
                  <dt>{sentence(k.replaceAll("_", " "))}</dt>
                  <dd>
                    {k === "amount" && typeof v === "number"
                      ? money(v, String(detail.currency ?? ""))
                      : typeof v === "string" && isoDate.test(v)
                        ? new Date(v).toLocaleString()
                        : String(v)}
                  </dd>
                </div>
              </React.Fragment>
            ))}
        </dl>
      )}
    </article>
  );
  return (
    <div className="shell">
      <div className="titlebar">
        <form
          className="titlebar-command"
          onSubmit={(e) => {
            e.preventDefault();
            const text = quick.trim();
            if (!text) return;
            e.currentTarget.querySelector("input")?.blur();
            setQuick("");
            setExpanded(true);
            followChat.current = true;
            void send(text);
          }}
        >
          <Icon name="sparkles" size={14} />
          <input
            aria-label="Ask your agent"
            placeholder={
              agentReady ? "Ask your agent…" : "Connecting your agent…"
            }
            disabled={!agentReady}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
          />
        </form>
        <div className="titlebar-end">{account ?? <Avatar />}</div>
      </div>
      <Sidebar
        page={page}
        onNavigate={navigate}
        taskCount={tasks.length}
        workspaceName={workspaceName}
        workspacePicker={workspacePicker}
      />
      <section className={"content" + (guided ? " guided" : "")}>
        <PageHeader title={page}>
          {page === "Workflows" && (
            <>
              <div className="segmented view-toggle" aria-label="View">
                <button
                  className={view === "canvas" ? "selected" : ""}
                  aria-pressed={view === "canvas"}
                  onClick={() => setView("canvas")}
                >
                  <Icon name="workflow" size={14} />
                  Canvas
                </button>
                <button
                  className={view === "list" ? "selected" : ""}
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <Icon name="layers" size={14} />
                  List
                </button>
              </div>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => setCreating(true)}
              >
                <Icon name="plus" size={16} strokeWidth={2.25} />
                New workflow
              </button>
            </>
          )}
        </PageHeader>
        {guided && (
          <div className="guide">
            <Icon name="navigation" size={14} />
            Your agent opened this for you
            <button
              className="btn ghost sm"
              onClick={() => {
                setGuiding(false);
                setGuided(false);
              }}
            >
              Stop guiding
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
            <button className="btn ghost sm" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {page === "Workflows" && tasks.length > 0 && (
          <div className="attention">
            <div className="attention-head">
              <Icon name="inbox" size={16} />
              <span className="eyebrow">Assigned to you</span>
            </div>
            {tasks.map((t) => (
              <button
                key={t.id}
                className="task"
                onClick={() => {
                  setTask(t);
                  setDetail(null);
                  setAnswer("");
                  setSelected(t.run_id);
                }}
              >
                <strong>{t.title}</strong>
                <span className="tag">
                  {sentence(t.kind.replaceAll("_", " "))}
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
          </div>
        )}
        {page === "Memory" && (
          <div className="filters">
            <div className="segmented">
              {["temporal", "canonical", "procedures", "context"].map((a) => (
                <button
                  key={a}
                  className={area === a ? "selected" : ""}
                  onClick={() => {
                    setArea(a);
                    setSelected(undefined);
                  }}
                >
                  {sentence(a)}
                </button>
              ))}
            </div>
            <div className="search">
              <Icon name="search" size={16} />
              <input
                aria-label="Search memory"
                placeholder="Search memory…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        )}
        {page === "Team" ? (
          <Team client={client} base={base} userId={userId} role={role} />
        ) : page === "Settings" ? (
          <Settings
            client={client}
            base={base}
            role={role}
            act={act}
            workspaceName={workspaceName}
          />
        ) : page === "Workflows" &&
          view === "canvas" &&
          !viewLoading &&
          !viewFailed &&
          rows.length > 0 ? (
          <div className="stack">
            <WorkflowGraph
              rows={rows}
              tasks={tasks}
              selected={selected}
              onSelect={open}
              compact={Boolean(detail)}
            />
            {detailCard}
          </div>
        ) : (
          <div className="content-grid">
            <div className="list">
              {page === "Payments" && paymentState === "loading" ? (
                <EmptyState
                  icon="card"
                  title="Loading transactions…"
                  role="status"
                >
                  <p>Fetching the latest payment activity.</p>
                </EmptyState>
              ) : page === "Payments" && paymentState === "error" ? (
                <EmptyState
                  icon="alert"
                  title="Couldn’t load transactions"
                  role="alert"
                >
                  <p>{paymentError}</p>
                  <button
                    className="btn"
                    onClick={() => setPaymentAttempt((n) => n + 1)}
                  >
                    <Icon name="refresh" size={15} />
                    Try again
                  </button>
                </EmptyState>
              ) : page !== "Payments" && viewLoading ? (
                <EmptyState
                  icon={page === "Workflows" ? "workflow" : "book"}
                  title={`Loading ${page.toLowerCase()}…`}
                  role="status"
                >
                  <p>Getting your workspace up to date.</p>
                </EmptyState>
              ) : page !== "Payments" && viewFailed ? (
                <EmptyState icon="alert" title="Couldn’t load this view">
                  <button
                    className="btn"
                    onClick={() => {
                      setViewLoading(true);
                      void load()
                        .catch((e) => setError(e.message))
                        .finally(() => setViewLoading(false));
                    }}
                  >
                    <Icon name="refresh" size={15} />
                    Try again
                  </button>
                </EmptyState>
              ) : visibleRows.length === 0 ? (
                <EmptyState
                  icon={
                    page === "Workflows"
                      ? "workflow"
                      : page === "Payments"
                        ? "card"
                        : "book"
                  }
                  title={
                    page === "Workflows"
                      ? "Start with a decision"
                      : page === "Payments"
                        ? "No payments yet"
                        : "No records in this area"
                  }
                >
                  <p>
                    {page === "Workflows"
                      ? "Propose an ADR or explore a feature with your team."
                      : page === "Payments"
                        ? "No transactions were returned by your connected payment account."
                        : "Workflow proposals and findings appear here as work progresses."}
                  </p>
                </EmptyState>
              ) : (
                visibleRows.map((row) => {
                  const id = row.id ?? row.record_id ?? row.external_id;
                  const state = row.data?.state as string | undefined;
                  return (
                    <button
                      className={"record" + (selected === id ? " active" : "")}
                      key={id}
                      onClick={() => open(id)}
                    >
                      <span className="record-icon" aria-hidden="true">
                        <Icon
                          name={
                            page === "Workflows"
                              ? row.kind === "adr"
                                ? "file"
                                : "compass"
                              : page === "Payments"
                                ? "card"
                                : "book"
                          }
                          size={16}
                        />
                      </span>
                      <span className="record-body">
                        <strong>
                          {row.input?.title ?? row.title ?? row.external_id}
                        </strong>
                        <small>
                          {page === "Workflows"
                            ? row.kind === "adr"
                              ? "ADR review"
                              : "Feature planning"
                            : page === "Memory"
                              ? `${sentence(row.area ?? "")} · Revision ${row.revision}`
                              : `${row.data?.currency ?? "Payment"} · ${money(
                                  row.data?.amount ?? 0,
                                  row.data?.currency,
                                )}`}
                        </small>
                        {row.error && (
                          <span className="error-text">{row.error}</span>
                        )}
                      </span>
                      {page === "Workflows" ? (
                        <span
                          className={
                            "tag " +
                            (row.stage === "completed" ? "success" : "outline")
                          }
                        >
                          {sentence(spaced(row.stage ?? ""))}
                        </span>
                      ) : page === "Payments" ? (
                        <span className={"tag " + paymentTone(state)}>
                          {sentence(state ?? "unknown")}
                        </span>
                      ) : (
                        <Icon
                          name="chevron-right"
                          size={16}
                          className="record-chevron"
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>
            {detailCard}
          </div>
        )}
        {page === "Workflows" && activity.length > 0 && (
          <div className="activity">
            <span className="eyebrow">Recent activity</span>
            {activity.slice(0, 6).map((e) => (
              <div className="activity-row" key={e.id}>
                <Icon name="zap" size={14} />
                <span>{sentence(e.kind.replaceAll(".", " "))}</span>
                <time>{new Date(e.created_at).toLocaleTimeString()}</time>
              </div>
            ))}
          </div>
        )}
      </section>
      {creating && (
        <Modal label="New workflow" onClose={() => setCreating(false)}>
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const created = await client.request<Row>(
                  `${base}/workflows`,
                  "POST",
                  { kind, title, body },
                  crypto.randomUUID(),
                );
                setSelected(created.id);
                setCreating(false);
                setTitle("");
                setBody("");
              });
            }}
          >
            <h2>Start a workflow</h2>
            <p>
              Set this workflow’s review rules in its detail view after creating
              it.
            </p>
            <div className="form">
              <label>
                Workflow
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="adr">ADR review</option>
                  <option value="feature">Feature planning</option>
                </select>
              </label>
              <label>
                Title
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Proposal
                <textarea
                  required
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                Start workflow
              </button>
            </div>
          </form>
        </Modal>
      )}
      {task && (
        <Modal label="Respond to task" onClose={() => setTask(null)}>
          <div className="modal">
            <span className="eyebrow">{task.kind.replaceAll("_", " ")}</span>
            <h2>{task.title}</h2>
            <p>
              Revision {task.revision}. Your response is recorded as a human
              decision.
            </p>
            {detail && detail.id === task.run_id ? (
              <div className="prose">
                {detail.snapshot?.body ?? detail.input?.body}
              </div>
            ) : (
              <p className="muted">
                <span className="spinner" aria-hidden="true" /> Loading the
                proposal…
              </p>
            )}
            <label>
              Your response
              <textarea
                aria-label="Task response"
                rows={5}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your feedback or answer…"
              />
            </label>
            <div className="actions">
              <button className="btn" onClick={() => setTask(null)}>
                Close
              </button>
              {(["approval", "peer_review"].includes(task.kind)
                ? ["changes_requested", "approved"]
                : task.kind === "acknowledgment"
                  ? ["acknowledged"]
                  : ["answered"]
              ).map((decision) => (
                <button
                  key={decision}
                  className={
                    "btn" + (decision === "changes_requested" ? "" : " primary")
                  }
                  disabled={
                    busy ||
                    detail?.id !== task.run_id ||
                    (decision !== "approved" &&
                      decision !== "acknowledged" &&
                      !answer.trim())
                  }
                  onClick={() =>
                    void act(async () => {
                      await client.request(
                        `${base}/tasks/${task.id}/responses`,
                        "POST",
                        {
                          revision: task.revision,
                          response: { decision, text: answer },
                        },
                        crypto.randomUUID(),
                      );
                      setTask(null);
                    })
                  }
                >
                  {decision === "approved" && (
                    <Icon name="check" size={15} strokeWidth={2.25} />
                  )}
                  {decision === "approved"
                    ? "Approve"
                    : decision === "changes_requested"
                      ? "Request changes"
                      : decision === "acknowledged"
                        ? "Acknowledge"
                        : "Submit answer"}
                </button>
              ))}
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost sm"
                onClick={() => {
                  setExpanded(true);
                  setPrompt(`Help me with task ${task.id}: ${task.title}`);
                  setTask(null);
                }}
              >
                <Icon name="sparkles" size={15} />
                Work on this with my agent
              </button>
            </div>
          </div>
        </Modal>
      )}
      <AgentPanel
        expanded={expanded}
        onToggle={() => {
          followChat.current = true;
          setExpanded(!expanded);
        }}
        pill={pill}
        page={page}
        agentReady={agentReady}
        chatBusy={chatBusy}
        status={status}
        tasksPending={tasks.length}
        messages={messages}
        stream={stream}
        prompt={prompt}
        onPrompt={setPrompt}
        onSend={() => void send()}
        guiding={guiding}
        onGuiding={setGuiding}
        onPauseResume={() =>
          void (status === "Paused"
            ? window.businessOS?.resume()
            : window.businessOS?.stop())
        }
        connectionError={agentConnectionError}
        logRef={chatMessages}
        onScroll={(e) => {
          const node = e.currentTarget;
          followChat.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        }}
      />
    </div>
  );
}
