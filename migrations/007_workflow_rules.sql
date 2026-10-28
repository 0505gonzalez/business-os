-- Rules belong to a workflow. Preserve existing runs' policies during upgrade.
CREATE TABLE workflow_rules (
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  domain text NOT NULL,
  approver_role text NOT NULL,
  informed_roles text[] NOT NULL DEFAULT '{}',
  acknowledgment_roles text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (run_id, domain)
);
INSERT INTO workflow_rules(run_id,domain,approver_role,informed_roles,acknowledgment_roles,version)
SELECT w.id,r.domain,r.approver_role,r.informed_roles,r.acknowledgment_roles,r.version
FROM workflow_runs w JOIN routing_rules r ON r.workspace_id=w.workspace_id;
-- routing_rules remains only as historical upgrade data; runtime no longer reads it.
