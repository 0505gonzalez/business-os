CREATE TABLE users (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE memberships ADD COLUMN joined_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invitations ADD COLUMN label text NOT NULL DEFAULT '';
ALTER TABLE invitations ADD COLUMN created_by text;
ALTER TABLE invitations ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invitations ADD COLUMN accepted_at timestamptz;
ALTER TABLE invitations ADD COLUMN revoked_at timestamptz;
CREATE INDEX invitations_workspace ON invitations(workspace_id, created_at DESC);
