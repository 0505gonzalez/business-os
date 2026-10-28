import React from "react";
import { createRoot } from "react-dom/client";
import { Workbench } from "../../apps/desktop/src/renderer";
import { ApiClient } from "../../packages/api-client/src";
const id = "00000000-0000-4000-a000-000000000001";
const controls = { paymentFailures: 0, noRules: false, slowMemory: false };
(window as any).fixtureControls = controls;
const workflow = {
  id,
  input: {
    title: "Introduce usage-based pricing",
    body: "Review the proposed pricing model and launch criteria.",
  },
  kind: "adr",
  stage: "review",
  snapshot: {
    body: "The proposed plan introduces usage tiers with a clear monthly cap.",
  },
  tasks: [],
  jobs: [],
};
let tasks = [
  {
    id,
    run_id: id,
    title: "Review: usage-based pricing",
    kind: "approval",
    revision: 1,
  },
];
const record = {
  record_id: id,
  id,
  title: "Pricing principles",
  body: "Customers should understand their bill before committing.",
  area: "canonical",
  revision: 1,
  approvals: [],
};
const payment = {
  external_id: "TR_SANDBOX",
  data: {
    id: "TR_SANDBOX",
    amount: 12500,
    currency: "USD",
    state: "SUCCEEDED",
  },
};
let members = [
  {
    user_id: "user_test",
    display_name: "Alex Owner",
    role: "owner",
    joined_at: "2026-10-28",
  },
  {
    user_id: "user_engineer",
    display_name: "Sam Engineer",
    role: "engineer",
    joined_at: "2026-10-28",
  },
];
let invitations: any[] = [];
class FixtureClient extends ApiClient {
  async request<T = any>(
    route: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    let value: unknown = [];
    if (route.endsWith("/rules"))
      value = controls.noRules
        ? []
        : [
            {
              domain: "pricing",
              approver_role: "owner",
              informed_roles: [],
              acknowledgment_roles: [],
              version: 1,
            },
          ];
    else if (route.endsWith("/tasks")) value = tasks;
    else if (route.includes("/responses")) {
      tasks = [];
      value = { ok: true };
    } else if (route.endsWith("/workflows"))
      value = method === "POST" ? workflow : [workflow];
    else if (route.includes("/workflows/")) value = workflow;
    else if (route.includes("/memory?")) {
      if (controls.slowMemory)
        await new Promise((resolve) => setTimeout(resolve, 500));
      value = [record];
    } else if (route.endsWith("/history")) value = [record];
    else if (route.includes("/memory/")) value = record;
    else if (route.includes("/payments?refresh=true")) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (controls.paymentFailures > 0) {
        controls.paymentFailures--;
        throw new Error("Payment service temporarily unavailable");
      }
      value = [payment];
    } else if (route.endsWith("/payments")) value = [payment];
    else if (route.includes("/payments/")) value = payment.data;
    else if (route.endsWith("/members")) value = members;
    else if (route.includes("/members/")) {
      const userId = route.split("/").at(-1);
      if (method === "DELETE")
        members = members.filter((m) => m.user_id !== userId);
      else
        members = members.map((m) =>
          m.user_id === userId ? { ...m, role: (body as any).role } : m,
        );
      value = { ok: true };
    } else if (route.endsWith("/invitations")) {
      if (method === "POST") {
        invitations.unshift({
          id,
          label: (body as any).label,
          role: (body as any).role,
          status: "pending",
          expires_at: "2026-11-04",
        });
        value = { id, token: "test-single-use-invitation" };
      } else value = invitations;
    } else if (route.includes("/invitations/") && method === "DELETE") {
      invitations = invitations.map((i) => ({ ...i, status: "revoked" }));
      value = { ok: true };
    }
    return value as T;
  }
}
window.businessOS = {
  context: async () => {},
  onEvent: () => () => {},
  chat: async () => ({
    text:
      "## Workflow summary\n\n**Ready for review**\n\n- Confirm pricing\n- Gather feedback\n\n`workflow-123`\n\n" +
      "A detailed workflow explanation with review steps and decisions. ".repeat(
        100,
      ) +
      "\n" +
      "long-record-identifier-".repeat(60),
  }),
} as unknown as NonNullable<typeof window.businessOS>;
createRoot(document.getElementById("test-root")!).render(
  <Workbench
    client={new FixtureClient("http://localhost", async () => "test")}
    workspaceId={id}
    userId="user_test"
    workspaceName="Acme Studio"
    role="owner"
  />,
);
