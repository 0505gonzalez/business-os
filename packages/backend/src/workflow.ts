import {
  Annotation,
  StateGraph,
  START,
  END,
  interrupt,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type {
  PlanningMap,
  WaitDescriptor,
  HumanResponse,
} from "../../contracts/src/index.js";
const State = Annotation.Root({
  kind: Annotation<"adr" | "feature">(),
  title: Annotation<string>(),
  body: Annotation<string>(),
  domain: Annotation<string>(),
  round: Annotation<number>(),
  map: Annotation<PlanningMap>(),
  feedback: Annotation<string>(),
  decision: Annotation<string>(),
  engineering: Annotation<string>(),
});
type S = typeof State.State;
const wait = (d: WaitDescriptor) => interrupt(d);
const agent = (s: S, action: string, prompt: string) =>
  wait({ type: "agent", action, prompt, round: s.round, domain: s.domain });
const human = (s: S, action: string, prompt: string) =>
  wait({
    type: "human",
    action,
    prompt,
    round: s.round,
    domain: s.domain,
  }) as HumanResponse;
export function buildWorkflow(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(State)
    .addNode("interview", (s) => {
      const answer = human(
        s,
        "product_interview",
        "Describe what finished looks like, acceptance criteria, constraints, and open decisions.",
      );
      return { body: s.body + "\n\n" + answer.text };
    })
    .addNode("createMap", (s) => ({
      map: agent(
        s,
        "map",
        `Create an exploration map. Return destination, acceptanceCriteria, notes, decisions, suspectedDecisions, ruledOut, and questions. Each question needs id, title, kind (research/prototype/conversation/chore), blockedBy. Capture only clearly stated questions; put unformed questions in suspectedDecisions. Proposal: ${s.body}`,
      ) as PlanningMap,
    }))
    .addNode("exploration", (s) => ({
      map: wait({
        type: "exploration",
        action: "exploration",
        prompt: "Resolve the exploration questions",
        round: s.round,
        map: s.map,
      }) as PlanningMap,
    }))
    .addNode("synthesis", (s) => {
      const draft = agent(
        s,
        "draft",
        `Synthesize a product proposal from this exploration: ${JSON.stringify(s.map)}. Return title and body.`,
      ) as { title: string; body: string };
      return { ...draft, round: s.round + 1 };
    })
    .addNode("classification", (s) => {
      const result = agent(
        s,
        "classify",
        `Classify this proposal into one configured domain. Return domain and reason. Proposal: ${s.title}\n${s.body}`,
      ) as { domain: string };
      return { domain: result.domain };
    })
    .addNode("review", (s) => {
      const response = human(s, "review", s.body);
      return { decision: response.decision, feedback: response.text };
    })
    .addNode("revision", (s) => {
      const draft = agent(
        s,
        "draft",
        `Revise this proposal using the feedback. Return title and body. Proposal: ${s.body}\nFeedback: ${s.feedback}`,
      ) as { title: string; body: string };
      return { ...draft, round: s.round + 1 };
    })
    .addNode("technicalInterview", (s) => ({
      engineering: human(
        s,
        "engineer_interview",
        "Clarify technical requirements, constraints, integration boundaries and how to validate the approved product proposal.",
      ).text,
    }))
    .addNode("design", (s) => {
      const draft = agent(
        s,
        "draft",
        `Create or revise the technical plan. Return title and body. Approved product proposal: ${s.body}\nEngineer interview: ${s.engineering}\nReview feedback: ${s.feedback ?? ""}`,
      ) as { title: string; body: string };
      return { ...draft, round: s.round + 1 };
    })
    .addNode("peerReview", (s) => {
      const response = human(s, "peer_review", s.body);
      return { decision: response.decision, feedback: response.text };
    })
    .addConditionalEdges(START, (s) =>
      s.kind === "feature" ? "interview" : "classification",
    )
    .addEdge("interview", "createMap")
    .addEdge("createMap", "exploration")
    .addEdge("exploration", "synthesis")
    .addEdge("synthesis", "classification")
    .addEdge("classification", "review")
    .addConditionalEdges("review", (s) =>
      s.decision === "approved"
        ? s.kind === "feature"
          ? "technicalInterview"
          : END
        : "revision",
    )
    .addEdge("revision", "classification")
    .addEdge("technicalInterview", "design")
    .addEdge("design", "peerReview")
    .addConditionalEdges("peerReview", (s) =>
      s.decision === "approved" ? END : "design",
    )
    .compile({ checkpointer });
}
