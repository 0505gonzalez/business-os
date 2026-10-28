import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "../database.js";
import { AppError, requireValue } from "../errors.js";
const roleSchema = z.string().trim().min(1).max(80);
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
async function lockOwner(c: PoolClient, r: FastifyRequest) {
  await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
    r.workspaceId,
  ]);
  const member = await c.query(
    "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
    [r.workspaceId, r.userId],
  );
  if (member.rows[0]?.role !== "owner")
    throw new AppError(403, "Workspace owner required");
}
async function record(
  c: PoolClient,
  r: FastifyRequest,
  kind: string,
  payload: unknown,
) {
  await c.query(
    "INSERT INTO events(workspace_id,user_id,kind,payload) VALUES($1,$2,$3,$4)",
    [r.workspaceId, r.userId, kind, payload],
  );
}
export function registerTeamRoutes(api: FastifyInstance) {
  api.put("/profile", async (r) => {
    const { displayName } = z
      .object({ displayName: z.string().trim().min(1).max(120) })
      .parse(r.body);
    await db.query(
      "INSERT INTO users(id,display_name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,updated_at=now()",
      [r.userId, displayName],
    );
    return { ok: true };
  });
  api.get(
    "/:workspaceId/members",
    async (r) =>
      (
        await db.query(
          "SELECT m.user_id,m.role,m.joined_at,COALESCE(u.display_name,m.user_id) AS display_name FROM memberships m LEFT JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.joined_at,m.user_id",
          [r.workspaceId],
        )
      ).rows,
  );
  api.put("/:workspaceId/members/:userId", async (r) => {
    const { role } = z.object({ role: roleSchema }).parse(r.body);
    const userId = (r.params as { userId: string }).userId;
    await transaction(async (c) => {
      await lockOwner(c, r);
      const current = requireValue(
        (
          await c.query(
            "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
            [r.workspaceId, userId],
          )
        ).rows[0],
      );
      if (
        current.role === "owner" &&
        role !== "owner" &&
        (
          await c.query(
            "SELECT 1 FROM memberships WHERE workspace_id=$1 AND role='owner'",
            [r.workspaceId],
          )
        ).rowCount === 1
      )
        throw new AppError(409, "Keep at least one workspace owner");
      await c.query(
        "UPDATE memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
        [r.workspaceId, userId, role],
      );
      await record(c, r, "team.role_changed", { userId, role });
    });
    return { ok: true };
  });
  api.delete("/:workspaceId/members/:userId", async (r) => {
    const userId = (r.params as { userId: string }).userId;
    await transaction(async (c) => {
      await lockOwner(c, r);
      const member = requireValue(
        (
          await c.query(
            "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
            [r.workspaceId, userId],
          )
        ).rows[0],
      );
      if (
        member.role === "owner" &&
        (
          await c.query(
            "SELECT 1 FROM memberships WHERE workspace_id=$1 AND role='owner'",
            [r.workspaceId],
          )
        ).rowCount === 1
      )
        throw new AppError(409, "Keep at least one workspace owner");
      const pending = await c.query(
        "SELECT 1 FROM tasks WHERE workspace_id=$1 AND assignee_id=$2 AND status='ready' UNION ALL SELECT 1 FROM workflow_runs WHERE workspace_id=$1 AND owner_id=$2 AND stage<>'completed' LIMIT 1",
        [r.workspaceId, userId],
      );
      if (pending.rowCount)
        throw new AppError(
          409,
          "This person has active tasks or owns an unfinished workflow. Complete that work before removing them.",
        );
      await c.query(
        "DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2",
        [r.workspaceId, userId],
      );
      await c.query(
        "UPDATE invitations SET revoked_at=now() WHERE workspace_id=$1 AND accepted_by=$2 AND revoked_at IS NULL",
        [r.workspaceId, userId],
      );
      await record(c, r, "team.member_removed", { userId });
    });
    return { ok: true };
  });
  api.get("/:workspaceId/invitations", async (r) => {
    if (r.role !== "owner") throw new AppError(403, "Workspace owner required");
    return (
      await db.query(
        "SELECT id,label,role,created_at,expires_at,accepted_by,accepted_at,revoked_at,CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN accepted_by IS NOT NULL THEN 'accepted' WHEN expires_at<=now() THEN 'expired' ELSE 'pending' END AS status FROM invitations WHERE workspace_id=$1 ORDER BY created_at DESC",
        [r.workspaceId],
      )
    ).rows;
  });
  api.post("/:workspaceId/invitations", async (r) => {
    const { role, label, expiresInDays } = z
      .object({
        role: roleSchema,
        label: z.string().trim().max(120).default(""),
        expiresInDays: z.number().int().min(1).max(30).default(7),
      })
      .parse(r.body);
    const token = randomBytes(32).toString("base64url");
    return transaction(async (c) => {
      await lockOwner(c, r);
      const invitation = (
        await c.query(
          "INSERT INTO invitations(id,workspace_id,role,token_hash,expires_at,label,created_by) VALUES($1,$2,$3,$4,now()+make_interval(days=>$5),$6,$7) RETURNING id,expires_at",
          [
            randomUUID(),
            r.workspaceId,
            role,
            hash(token),
            expiresInDays,
            label,
            r.userId,
          ],
        )
      ).rows[0];
      await record(c, r, "team.invitation_created", {
        invitationId: invitation.id,
        label,
        role,
      });
      return { ...invitation, token };
    });
  });
  api.delete("/:workspaceId/invitations/:id", async (r) => {
    const id = z.uuid().parse((r.params as { id: string }).id);
    await transaction(async (c) => {
      await lockOwner(c, r);
      const invitation = requireValue(
        (
          await c.query(
            "SELECT * FROM invitations WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [r.workspaceId, id],
          )
        ).rows[0],
      );
      if (invitation.accepted_by)
        throw new AppError(
          409,
          "Invitation already accepted. Manage the person in Team.",
        );
      await c.query(
        "UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
        [id],
      );
      await record(c, r, "team.invitation_revoked", { invitationId: id });
    });
    return { ok: true };
  });
  api.post("/invitations/accept", async (r) => {
    const { token } = z
      .object({ token: z.string().trim().min(1).max(200) })
      .parse(r.body);
    return transaction(async (c) => {
      const found = (
        await c.query(
          "SELECT workspace_id FROM invitations WHERE token_hash=$1",
          [hash(token)],
        )
      ).rows[0];
      if (!found) throw new AppError(404, "Invitation not found");
      await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        found.workspace_id,
      ]);
      const invite = (
        await c.query(
          "SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE",
          [hash(token)],
        )
      ).rows[0];
      if (invite.revoked_at) throw new AppError(410, "Invitation was revoked");
      if (invite.accepted_by) {
        const member = await c.query(
          "SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2",
          [invite.workspace_id, r.userId],
        );
        if (invite.accepted_by === r.userId && member.rowCount)
          return { workspaceId: invite.workspace_id };
        throw new AppError(409, "Invitation already used");
      }
      if (new Date(invite.expires_at).getTime() <= Date.now())
        throw new AppError(
          410,
          "Invitation expired. Ask an owner for a new code.",
        );
      await c.query(
        "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [invite.workspace_id, r.userId, invite.role],
      );
      await c.query(
        "UPDATE invitations SET accepted_by=$2,accepted_at=now() WHERE id=$1",
        [invite.id, r.userId],
      );
      await c.query(
        "INSERT INTO events(workspace_id,user_id,kind,payload) VALUES($1,$2,$3,$4)",
        [
          invite.workspace_id,
          r.userId,
          "team.member_joined",
          { invitationId: invite.id },
        ],
      );
      return { workspaceId: invite.workspace_id };
    });
  });
}
