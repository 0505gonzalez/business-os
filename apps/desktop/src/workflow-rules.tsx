import React, { useState, useEffect } from "react";
import { ApiClient } from "../../../packages/api-client/src/index.js";
type Row = Record<string, any>;
export function WorkflowRules({
  client,
  base,
  editable,
  act,
}: {
  client: ApiClient;
  base: string;
  editable: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [rules, setRules] = useState<Row[]>([]),
    [domain, setDomain] = useState(""),
    [approver, setApprover] = useState(""),
    [informed, setInformed] = useState(""),
    [ack, setAck] = useState("");
  const load = async () => {
    setRules(await client.request(`${base}/rules`));
  };
  useEffect(() => {
    void act(load);
  }, [base]);
  return (
    <div className="settings workflow-rules">
      <article>
        <h3>Review rules</h3>
        <p>
          Choose who approves, acknowledges, or is informed in this workflow.
          Assign team roles in Team. Changes apply to future tasks; existing
          assignments keep their original rules.
        </p>
        {!rules.length && (
          <p className="muted">
            Add rules for this workflow. They do not apply to other workflows.
          </p>
        )}
        {rules.map((r) => (
          <button
            className="rule"
            key={r.domain}
            onClick={() => {
              setDomain(r.domain);
              setApprover(r.approver_role);
              setInformed(r.informed_roles.join(", "));
              setAck(r.acknowledgment_roles.join(", "));
            }}
          >
            {r.domain} → {r.approver_role} approval <small>v{r.version}</small>
          </button>
        ))}
        {editable && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await client.request(
                  `${base}/rules/${encodeURIComponent(domain)}`,
                  "PUT",
                  {
                    approverRole: approver,
                    informedRoles: informed
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    acknowledgmentRoles: ack
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                );
                await load();
              });
            }}
          >
            <label>
              Domain
              <input
                required
                placeholder="e.g. pricing, engineering, product"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </label>
            <label>
              Approver role
              <input
                required
                placeholder="e.g. owner, ceo, engineer"
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
              />
            </label>
            <label>
              Informed roles (comma separated)
              <input
                value={informed}
                onChange={(e) => setInformed(e.target.value)}
              />
            </label>
            <label>
              Acknowledgment roles
              <input value={ack} onChange={(e) => setAck(e.target.value)} />
            </label>
            <button className="primary">Save rule</button>
          </form>
        )}
      </article>
    </div>
  );
}
