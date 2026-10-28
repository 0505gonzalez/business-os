CREATE TABLE IF NOT EXISTS agents(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),owner_id text NOT NULL,name text NOT NULL DEFAULT 'Your agent',provider text NOT NULL CHECK(provider='claude'),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,owner_id),FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,user_id));
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id);
DROP TABLE IF EXISTS request_keys;
DROP TABLE IF EXISTS conversations;
