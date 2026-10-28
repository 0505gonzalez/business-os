import { z } from "zod";
export const questionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1),
  kind: z.enum(["research", "prototype", "conversation", "chore"]),
  blockedBy: z.array(z.string()),
  result: z.string().optional(),
});
export const mapSchema = z.object({
  destination: z.string(),
  acceptanceCriteria: z.array(z.string()),
  notes: z.array(z.string()),
  decisions: z.array(z.string()),
  suspectedDecisions: z.array(z.string()),
  ruledOut: z.array(z.string()),
  questions: z.array(questionSchema),
});
export const draftSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});
export const classificationSchema = z.object({
  domain: z.string().min(1),
  reason: z.string(),
});
export const responseSchema = z.object({
  decision: z.enum([
    "approved",
    "changes_requested",
    "answered",
    "acknowledged",
  ]),
  text: z.string().default(""),
});
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    page: z.enum(["Workflows", "Memory", "Payments"]),
    id: z.string().optional(),
  }),
  z.object({ type: z.literal("highlight"), text: z.string() }),
]);
export type AppCommand = z.infer<typeof commandSchema>;
export type PlanningMap = z.infer<typeof mapSchema>;
export type HumanResponse = z.infer<typeof responseSchema>;
export type WaitDescriptor = {
  type: "agent" | "human" | "exploration";
  action: string;
  prompt: string;
  round: number;
  domain?: string;
  map?: PlanningMap;
  author?: string;
};
export type AgentEvent = {
  type: "text" | "status" | "command" | "error";
  text?: string;
  command?: AppCommand;
};
