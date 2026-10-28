import { WorkflowRules } from "./workflow-rules.js";
import { Modal } from "./modal.js";
import { Markdown } from "./markdown.js";
import { Team } from "./team.js";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { ApiClient } from "../../../packages/api-client/src/index.js";
import { commandSchema } from "../../../packages/contracts/src/index.js";
import { Settings } from "./settings.js";
import { PlanningMapView } from "./planning-map.js";
type Row = Record<string, any>;
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
  const [paymentRows, setPaymentRows] = useState<Row[]>([]);
  const [paymentState, setPaymentState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [paymentError, setPaymentError] = useState("");
  const [paymentAttempt, setPaymentAttempt] = useState(0);
  const chatMessages = useRef<HTMLDivElement>(null);
  const followChat = useRef(true);
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
  async function send() {
    const text = prompt;
    if (!text.trim() || !agentReady || chatBusy) return;
    followChat.current = true;
    setChatBusy(true);
    setPrompt("");
    setMessages((m) => [...m, { role: "you", text }]);
    setStream("");
    try {
      await act(async () => {
        if (!window.businessOS)
          throw new Error("The agent runs in the desktop application");
        const response = await window.businessOS.chat(text);
        setMessages((m) => [...m, { role: "agent", text: response.text }]);
      });
    } finally {
      setStream("");
      setChatBusy(false);
    }
  }
  const pill = !agentReady
    ? "Connecting agent…"
    : tasks.length
      ? `Needs you: ${tasks.length}`
      : status !== "Idle"
        ? status
        : jobs.some((j) => j.status === "failed")
          ? "Needs attention"
          : jobs.length
            ? "Work queued"
            : "Your agent";
  return (
    <main>
      <aside>
        <h2>
          business os<span>{workspaceName}</span>
        </h2>
        {workspacePicker}
        <nav>
          {["Workflows", "Payments", "Memory", "Team"].map((name) => (
            <button
              className={page === name ? "selected" : ""}
              onClick={() => navigate(name)}
              key={name}
            >
              {name}
              <span>
                {name === "Workflows" && tasks.length > 0 ? tasks.length : ""}
              </span>
            </button>
          ))}
        </nav>
        <footer>
          <button
            aria-label="Workspace settings"
            onClick={() => navigate("Settings")}
          >
            Settings
          </button>
          {account}
        </footer>
      </aside>
      <section className={guided ? "guided" : ""}>
        <header>
          <span>
            {workspaceName} / {page}
          </span>
          <span className="tag">Shared workspace</span>
        </header>
        {guided && (
          <div className="guide">
            Your agent opened this for you{" "}
            <button
              onClick={() => {
                setGuiding(false);
                setGuided(false);
              }}
            >
              Stop guiding
            </button>
          </div>
        )}
        <div className="heading">
          <div>
            <h1>{page}</h1>
            <p>
              {page === "Workflows"
                ? "Move decisions forward, together."
                : page === "Memory"
                  ? "Your company’s shared understanding."
                  : page === "Payments"
                    ? "Payment activity and context."
                    : "People and workspace roles."}
            </p>
          </div>
          {page === "Workflows" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => setCreating(true)}
            >
              + New workflow
            </button>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {page === "Workflows" && tasks.length > 0 && (
          <div className="attention">
            <span className="eyebrow">ASSIGNED TO YOU</span>
            {tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTask(t);
                  setDetail(null);
                  setAnswer("");
                  setSelected(t.run_id);
                }}
              >
                <strong>{t.title}</strong>
                <span>{t.kind.replaceAll("_", " ")} →</span>
              </button>
            ))}
          </div>
        )}
        {page === "Memory" && (
          <div className="filters">
            <div className="areas">
              {["temporal", "canonical", "procedures", "context"].map((a) => (
                <button
                  key={a}
                  className={area === a ? "selected" : ""}
                  onClick={() => {
                    setArea(a);
                    setSelected(undefined);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
            <input
              aria-label="Search memory"
              placeholder="Search memory…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        {page === "Team" ? (
          <Team client={client} base={base} userId={userId} role={role} />
        ) : page === "Settings" ? (
          <Settings client={client} base={base} role={role} act={act} />
        ) : (
          <div className="content-grid">
            <div className="list">
              {page === "Payments" && paymentState === "loading" ? (
                <article role="status" aria-live="polite">
                  <h3>Loading transactions…</h3>
                  <p>Fetching the latest payment activity.</p>
                </article>
              ) : page === "Payments" && paymentState === "error" ? (
                <article role="alert">
                  <h3>Couldn’t load transactions</h3>
                  <p>{paymentError}</p>
                  <button onClick={() => setPaymentAttempt((n) => n + 1)}>
                    Try again
                  </button>
                </article>
              ) : page !== "Payments" && viewLoading ? (
                <article role="status">
                  <h3>Loading {page.toLowerCase()}…</h3>
                  <p>Getting your workspace up to date.</p>
                </article>
              ) : page !== "Payments" && viewFailed ? (
                <article>
                  <h3>Couldn’t load this view</h3>
                  <button
                    onClick={() => {
                      setViewLoading(true);
                      void load()
                        .catch((e) => setError(e.message))
                        .finally(() => setViewLoading(false));
                    }}
                  >
                    Try again
                  </button>
                </article>
              ) : visibleRows.length === 0 ? (
                <article>
                  <h3>
                    {page === "Workflows"
                      ? "Start with a decision"
                      : page === "Payments"
                        ? "No payments yet"
                        : "No records in this area"}
                  </h3>
                  <p>
                    {page === "Workflows"
                      ? "Propose an ADR or explore a feature with your team."
                      : page === "Payments"
                        ? "No transactions were returned by your connected payment account."
                        : "Workflow proposals and findings appear here as work progresses."}
                  </p>
                </article>
              ) : (
                visibleRows.map((row) => {
                  const id = row.id ?? row.record_id ?? row.external_id;
                  return (
                    <button
                      className={"record " + (selected === id ? "active" : "")}
                      key={id}
                      onClick={() => {
                        setSelected(id);
                        setDetail(null);
                        setVersions([]);
                      }}
                    >
                      <span className="eyebrow">
                        {row.kind ?? row.area ?? row.data?.state}
                      </span>
                      <strong>
                        {row.input?.title ?? row.title ?? row.external_id}
                      </strong>
                      <small>
                        {row.stage?.replaceAll("_", " ") ??
                          (row.data
                            ? `${((row.data.amount ?? 0) / 100).toFixed(2)} ${row.data.currency ?? ""}`
                            : `Revision ${row.revision}`)}
                      </small>
                      {row.error && (
                        <span className="error-text">{row.error}</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
            {detail && (
              <article className="detail">
                <button
                  className="quiet"
                  onClick={() => {
                    setSelected(undefined);
                    setDetail(null);
                  }}
                >
                  ← Close
                </button>
                <h2>{detail.input?.title ?? detail.title ?? detail.id}</h2>
                {page === "Workflows" ? (
                  <>
                    {detail.error && (
                      <div className="setup-notice">
                        <div>
                          <strong>Needs attention</strong>
                          <p>{detail.error}</p>
                        </div>
                      </div>
                    )}
                    <div className="stages">
                      {(detail.kind === "adr"
                        ? ["classification", "review", "completed"]
                        : [
                            "interview",
                            "createMap",
                            "exploration",
                            "synthesis",
                            "classification",
                            "review",
                            "technicalInterview",
                            "design",
                            "peerReview",
                            "completed",
                          ]
                      ).map((stage) => (
                        <span
                          key={stage}
                          className={detail.stage === stage ? "current" : ""}
                        >
                          {stage}
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
                    <h3>Tasks</h3>
                    {detail.tasks?.map((t: Row) => (
                      <p key={t.id}>
                        {t.title} ·{" "}
                        {t.assignee_id === userId ? "You" : t.assignee_id} ·{" "}
                        {t.status}
                      </p>
                    ))}
                    <h3>Agent work</h3>
                    {detail.jobs?.map((j: Row) => (
                      <p key={j.id}>
                        {j.action} · {j.status}
                        {j.error && (
                          <span className="error-text">{j.error}</span>
                        )}
                        {j.status === "failed" && (
                          <button
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
                      </p>
                    ))}
                  </>
                ) : page === "Memory" ? (
                  <>
                    <span className="tag">
                      {detail.area} · revision {detail.revision}
                    </span>
                    <div className="prose">{detail.body}</div>
                    {detail.data?.kind === "prototype" &&
                      detail.body.includes("<") && (
                        <iframe
                          title="Prototype preview"
                          sandbox=""
                          srcDoc={detail.body.replace(
                            /^```html\s*|\s*```$/g,
                            "",
                          )}
                        />
                      )}
                    <p>
                      {detail.approvals
                        ?.map((a: Row) => `Approved by ${a.userId} (${a.role})`)
                        .join(", ")}
                    </p>
                    <button
                      onClick={() =>
                        void act(async () =>
                          setVersions(
                            await client.request(
                              `${base}/memory/${selected}/history`,
                            ),
                          ),
                        )
                      }
                    >
                      Revision history
                    </button>
                    {versions.map((v) => (
                      <details key={v.revision}>
                        <summary>
                          Revision {v.revision} · {v.area}
                        </summary>
                        <div className="prose">{v.body}</div>
                      </details>
                    ))}
                  </>
                ) : (
                  <>
                    <dl>
                      {Object.entries(detail)
                        .filter(([, v]) => typeof v !== "object")
                        .map(([k, v]) => (
                          <React.Fragment key={k}>
                            <dt>{k.replaceAll("_", " ")}</dt>
                            <dd>{String(v)}</dd>
                          </React.Fragment>
                        ))}
                    </dl>
                  </>
                )}
              </article>
            )}
          </div>
        )}
        {page === "Workflows" && activity.length > 0 && (
          <div className="activity">
            <span className="eyebrow">RECENT ACTIVITY</span>
            {activity.slice(0, 6).map((e) => (
              <p key={e.id}>
                {e.kind.replaceAll(".", " ")}{" "}
                <time>{new Date(e.created_at).toLocaleTimeString()}</time>
              </p>
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
            <div className="actions">
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Start workflow
              </button>
            </div>
          </form>
        </Modal>
      )}
      {task && (
        <Modal label="Respond to task" onClose={() => setTask(null)}>
          <div className="modal">
            <h2>{task.title}</h2>
            <p>
              Revision {task.revision}. Your response is recorded as a human
              decision.
            </p>
            <div className="prose">
              {detail?.snapshot?.body ?? detail?.input?.body}
            </div>
            <textarea
              aria-label="Task response"
              rows={7}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your feedback or answer…"
            />
            <div className="actions">
              <button onClick={() => setTask(null)}>Close</button>
              {(["approval", "peer_review"].includes(task.kind)
                ? ["changes_requested", "approved"]
                : task.kind === "acknowledgment"
                  ? ["acknowledged"]
                  : ["answered"]
              ).map((decision) => (
                <button
                  key={decision}
                  className={decision === "approved" ? "primary" : ""}
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
            <button
              className="quiet"
              onClick={() => {
                setExpanded(true);
                setPrompt(`Help me with task ${task.id}: ${task.title}`);
                setTask(null);
              }}
            >
              Work on this with my agent ↗
            </button>
          </div>
        </Modal>
      )}
      <div className={"agent-panel " + (expanded ? "expanded" : "")}>
        <button
          className="agent-header"
          aria-expanded={expanded}
          aria-label={expanded ? "Minimize agent" : pill}
          onClick={() => {
            followChat.current = true;
            setExpanded(!expanded);
          }}
        >
          <span
            className={
              "dot " + (tasks.length ? "amber" : chatBusy ? "working" : "")
            }
          />
          <span className="agent-title">
            {expanded ? "Your agent" : pill}
            {expanded && (
              <small>
                {chatBusy
                  ? "Working…"
                  : !agentReady
                    ? "Connecting…"
                    : `Viewing · ${page}`}
              </small>
            )}
          </span>
          <span className="agent-toggle" aria-hidden="true">
            {expanded ? "−" : "↗"}
          </span>
        </button>
        {expanded && (
          <>
            <div
              className="chat-messages"
              ref={chatMessages}
              onScroll={(e) => {
                const node = e.currentTarget;
                followChat.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 60;
              }}
              role="log"
              aria-label="Agent conversation"
            >
              {messages.length === 0 && (
                <p className="muted">
                  Ask about your workspace, or point me at a decision.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  className={
                    "message " + (m.role === "you" ? "you" : "assistant")
                  }
                  key={i}
                >
                  <small>{m.role}</small>
                  {m.role === "you" ? (
                    <div>{m.text}</div>
                  ) : (
                    <Markdown text={m.text} />
                  )}
                </div>
              ))}
              {stream && (
                <div className="message">
                  <small>agent</small>
                  <Markdown text={stream} />
                </div>
              )}
            </div>
            {agentConnectionError && (
              <p role="alert" className="agent-connection-error">
                {agentConnectionError}
              </p>
            )}
            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                rows={2}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
                aria-label="Message your agent"
                disabled={!agentReady}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  agentReady ? "Ask about your work…" : "Connecting your agent…"
                }
              />
              <button
                aria-label="Send message"
                disabled={!agentReady || !prompt.trim() || chatBusy}
              >
                ↑
              </button>
            </form>
            <div className="chat-controls">
              <button
                onClick={() =>
                  void (status === "Paused"
                    ? window.businessOS?.resume()
                    : window.businessOS?.stop())
                }
              >
                {status === "Paused" ? "Resume agent" : "Pause agent"}
              </button>
              <button onClick={() => setGuiding(!guiding)}>
                {guiding ? "Pause guidance" : "Allow guidance"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
