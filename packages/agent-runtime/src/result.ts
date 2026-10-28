import type { AgentSession } from "@earendil-works/pi-coding-agent";
export function finalAnswer(session: AgentSession) {
  const last = session.messages.filter((m) => m.role === "assistant").at(-1);
  if (
    last?.role === "assistant" &&
    (last.stopReason === "error" || last.stopReason === "aborted")
  )
    throw new Error(last.errorMessage ?? "Agent execution stopped");
  const text = session.getLastAssistantText();
  if (!text?.trim()) throw new Error("Agent returned no response");
  return text;
}
