-- Each server-side credential set belongs to exactly one company workspace.
CREATE TABLE integration_connections (
  credential_slot text PRIMARY KEY CHECK (credential_slot IN ('finix_sandbox')),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
