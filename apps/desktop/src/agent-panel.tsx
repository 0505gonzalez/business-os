import React, { useRef } from "react";
import { Icon } from "./icons.js";
import { Markdown } from "./markdown.js";
export type ChatMessage = { role: string; text: string };
const suggestions = [
  "What needs my approval?",
  "Summarize open workflows",
  "What did we decide on pricing?",
];
export function AgentPanel({
  expanded,
  onToggle,
  pill,
  page,
  agentReady,
  chatBusy,
  status,
  tasksPending,
  messages,
  stream,
  prompt,
  onPrompt,
  onSend,
  guiding,
  onGuiding,
  onPauseResume,
  connectionError,
  logRef,
  onScroll,
}: {
  expanded: boolean;
  onToggle: () => void;
  pill: string;
  page: string;
  agentReady: boolean;
  chatBusy: boolean;
  status: string;
  tasksPending: number;
  messages: ChatMessage[];
  stream: string;
  prompt: string;
  onPrompt: (text: string) => void;
  onSend: () => void;
  guiding: boolean;
  onGuiding: (next: boolean) => void;
  onPauseResume: () => void;
  connectionError: string;
  logRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const paused = status === "Paused";
  const working =
    chatBusy || !["Idle", "Paused", "Needs attention"].includes(status);
  const tone = !agentReady
    ? "idle"
    : tasksPending
      ? "amber"
      : working
        ? "working"
        : "";
  const substatus = chatBusy
    ? status !== "Idle"
      ? status
      : "Working…"
    : !agentReady
      ? "Connecting…"
      : paused
        ? "Paused"
        : `Viewing ${page}`;
  return (
    <aside
      className={"agent-panel " + (expanded ? "expanded" : "collapsed")}
      aria-label="Agent"
    >
      <button
        className="agent-header"
        aria-expanded={expanded}
        aria-label={expanded ? "Minimize agent" : pill}
        onClick={onToggle}
      >
        <span
          className={"orb " + (expanded ? (working ? "working" : "") : tone)}
          aria-hidden="true"
        />
        <span className="agent-title">
          {expanded ? "Agent" : pill}
          {expanded && <small>{substatus}</small>}
        </span>
        <span className="agent-toggle" aria-hidden="true">
          <Icon name={expanded ? "minimize" : "expand"} size={16} />
        </span>
      </button>
      {expanded && (
        <>
          {working && (
            <div className="agent-activity" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>{status !== "Idle" ? status : "Working on it…"}</span>
            </div>
          )}
          <div
            className="chat-messages"
            ref={logRef}
            onScroll={onScroll}
            role="log"
            aria-label="Agent conversation"
          >
            {messages.length === 0 && !stream && (
              <div className="chat-empty">
                <span className="orb large" aria-hidden="true" />
                <p className="muted">
                  Ask about your workspace, or point me at a decision.
                </p>
                <div className="chat-suggestions">
                  {suggestions.map((text) => (
                    <button
                      key={text}
                      className="suggestion"
                      disabled={!agentReady}
                      onClick={() => {
                        onPrompt(text);
                        composer.current?.focus();
                      }}
                    >
                      <Icon name="sparkles" size={13} />
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                className={
                  "message " + (m.role === "you" ? "you" : "assistant")
                }
                key={i}
              >
                <small>{m.role === "you" ? "You" : "Agent"}</small>
                {m.role === "you" ? (
                  <div>{m.text}</div>
                ) : (
                  <Markdown text={m.text} />
                )}
              </div>
            ))}
            {stream && (
              <div className="message assistant streaming">
                <small>Agent</small>
                <Markdown text={stream} />
              </div>
            )}
          </div>
          {connectionError && (
            <p role="alert" className="agent-connection-error">
              {connectionError}
            </p>
          )}
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
          >
            <textarea
              ref={composer}
              rows={1}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  onSend();
                }
              }}
              aria-label="Message your agent"
              disabled={!agentReady}
              value={prompt}
              onChange={(e) => onPrompt(e.target.value)}
              placeholder={
                agentReady ? "Ask about your work…" : "Connecting your agent…"
              }
            />
            <div className="chat-toolbar">
              <div className="chat-controls">
                <button type="button" className="chip" onClick={onPauseResume}>
                  <Icon name={paused ? "play" : "pause"} size={13} />
                  {paused ? "Resume agent" : "Pause agent"}
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => onGuiding(!guiding)}
                >
                  <Icon
                    name={guiding ? "navigation" : "navigation-off"}
                    size={13}
                  />
                  {guiding ? "Pause guidance" : "Allow guidance"}
                </button>
              </div>
              <button
                className="chat-send"
                aria-label="Send message"
                disabled={!agentReady || !prompt.trim() || chatBusy}
              >
                <Icon name="arrow-up" size={16} strokeWidth={2.25} />
              </button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
