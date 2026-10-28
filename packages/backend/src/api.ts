import { registerTeamRoutes } from "./modules/team.js";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { verifyToken } from "@clerk/backend";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./database.js";
import { history, readRecord, writeRecord, rebuildIndex } from "./brain.js";
import { syncPayments, processWebhook } from "./finix.js";
import { startRun, respondTask } from "./modules/workflows.js";
import {
  claimJob,
  heartbeatJob,
  completeJob,
  failJob,
} from "./modules/jobs.js";
import { AppError, requireValue } from "./errors.js";
declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    workspaceId: string;
    role: string;
  }
}
const uuid = z.uuid();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const owner = (r: FastifyRequest) => {
  if (r.role !== "owner") throw new AppError(403, "Workspace owner required");
};
export function createApi() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 2_000_000,
  });
  app.register(cors, {
    origin: [
      "business-os://renderer",
      ...(process.env.APP_ORIGINS ?? "").split(",").filter(Boolean),
    ],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    methods: ["GET", "POST", "PUT", "DELETE"],
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: "Invalid request", issues: error.issues });
    if (error instanceof AppError)
      return reply.code(error.status).send({ error: error.message });
    request.log.error(error);
    return reply
      .code(500)
      .send({ error: "The request could not be completed" });
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.register(
    async (hooks) => {
      hooks.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_r, body, done) => done(null, body),
      );
      hooks.post("/finix", async (r) =>
        processWebhook(
          r.body as Buffer,
          String(r.headers["finix-signature"] ?? ""),
          r.headers.authorization ?? "",
        ),
      );
    },
    { prefix: "/webhooks" },
  );
  app.register(
    async (api) => {
      api.addHook("preHandler", async (r) => {
        const token = r.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!token) throw new AppError(401, "Sign in required");
        try {
          const claims = await verifyToken(token, {
            secretKey: process.env.CLERK_SECRET_KEY,
            jwtKey: process.env.CLERK_JWT_KEY,
            authorizedParties: (
              process.env.CLERK_AUTHORIZED_PARTIES ?? "business-os://renderer"
            ).split(","),
          });
          r.userId = claims.sub;
        } catch {
          throw new AppError(401, "Session expired; sign in again");
        }
        const p = r.params as { workspaceId?: string };
        if (p.workspaceId) {
          r.workspaceId = uuid.parse(p.workspaceId);
          const member = (
            await db.query(
              "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
              [r.workspaceId, r.userId],
            )
          ).rows[0];
          if (!member) throw new AppError(403, "Workspace access denied");
          r.role = member.role;
        }
      });
      api.get(
        "/workspaces",
        async (r) =>
          (
            await db.query(
              "SELECT w.*,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1",
              [r.userId],
            )
          ).rows,
      );
      api.post("/workspaces", async (r) => {
        const { name } = z
          .object({ name: z.string().min(1).max(120) })
          .parse(r.body);
        const id = randomUUID();
        await transaction(async (c) => {
          await c.query("INSERT INTO workspaces VALUES($1,$2)", [id, name]);
          await c.query(
            "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)",
            [id, r.userId, "owner"],
          );
        });
        return { id, name, role: "owner" };
      });
      registerTeamRoutes(api);
      api.get(
        "/:workspaceId/agent",
        async (r) =>
          (
            await db.query(
              "INSERT INTO agents(id,workspace_id,owner_id,provider) VALUES($1,$2,$3,'claude') ON CONFLICT(workspace_id,owner_id) DO UPDATE SET provider=excluded.provider RETURNING id,name,provider",
              [randomUUID(), r.workspaceId, r.userId],
            )
          ).rows[0],
      );
      api.get(
        "/:workspaceId/workflows",
        async (r) =>
          (
            await db.query(
              "SELECT * FROM workflow_runs WHERE workspace_id=$1 ORDER BY created_at DESC",
              [r.workspaceId],
            )
          ).rows,
      );
      api.post("/:workspaceId/workflows", async (r) => {
        const body = z
          .object({
            kind: z.enum(["adr", "feature"]),
            title: z.string().min(1),
            body: z.string().min(1),
          })
          .parse(r.body);
        return startRun(
          r.workspaceId,
          r.userId,
          body.kind,
          body.title,
          body.body,
          uuid.parse(r.headers["idempotency-key"]),
        );
      });
      api.get("/:workspaceId/workflows/:id", async (r) => {
        const id = uuid.parse((r.params as any).id);
        const run = requireValue(
          (
            await db.query(
              "SELECT * FROM workflow_runs WHERE workspace_id=$1 AND id=$2",
              [r.workspaceId, id],
            )
          ).rows[0],
        );
        return {
          ...run,
          rules: (
            await db.query(
              "SELECT * FROM workflow_rules WHERE run_id=$1 ORDER BY domain",
              [id],
            )
          ).rows,
          tasks: (
            await db.query(
              "SELECT * FROM tasks WHERE run_id=$1 ORDER BY revision",
              [id],
            )
          ).rows,
          jobs: (
            await db.query(
              "SELECT id,action,question_id,status,error FROM agent_jobs WHERE run_id=$1",
              [id],
            )
          ).rows,
        };
      });
      api.get(
        "/:workspaceId/tasks",
        async (r) =>
          (
            await db.query(
              "SELECT * FROM tasks WHERE workspace_id=$1 AND assignee_id=$2 AND status='ready' ORDER BY revision",
              [r.workspaceId, r.userId],
            )
          ).rows,
      );
      api.post("/:workspaceId/tasks/:id/responses", async (r) => {
        const body = z
          .object({ revision: z.number().int(), response: z.unknown() })
          .parse(r.body);
        return respondTask(
          r.workspaceId,
          r.userId,
          uuid.parse((r.params as any).id),
          body.revision,
          body.response,
          uuid.parse(r.headers["idempotency-key"]),
        );
      });
      api.get("/:workspaceId/memory", async (r) => {
        const query = z
          .object({
            q: z.string().default(""),
            area: z
              .enum(["temporal", "canonical", "procedures", "context"])
              .optional(),
          })
          .parse(r.query);
        return (
          await db.query(
            "SELECT * FROM brain_index WHERE workspace_id=$1 AND ($2='' OR title ILIKE '%'||$2||'%' OR body ILIKE '%'||$2||'%') AND ($3::text IS NULL OR area=$3) ORDER BY title",
            [r.workspaceId, query.q, query.area ?? null],
          )
        ).rows;
      });
      api.get("/:workspaceId/memory/:id", async (r) =>
        readRecord(r.workspaceId, uuid.parse((r.params as any).id)),
      );
      api.get("/:workspaceId/memory/:id/history", async (r) =>
        history(r.workspaceId, uuid.parse((r.params as any).id)),
      );
      api.post("/:workspaceId/memory", async (r) => {
        const body = z
          .object({
            title: z.string().min(1),
            body: z.string(),
            kind: z.enum(["research", "procedure", "context"]),
          })
          .parse(r.body);
        return writeRecord({
          ...body,
          id: uuid.parse(r.headers["idempotency-key"]),
          workspaceId: r.workspaceId,
          revision: 1,
          area: "temporal",
          sources: [],
          approvals: [],
        });
      });
      api.post("/:workspaceId/memory/reindex", async (r) => {
        owner(r);
        return rebuildIndex(r.workspaceId);
      });
      api.get("/:workspaceId/payments", async (r) => {
        const { refresh } = z
          .object({ refresh: z.enum(["true", "false"]).optional() })
          .parse(r.query);
        if (refresh === "true") await syncPayments(r.workspaceId);
        return (
          await db.query(
            "SELECT external_id,data FROM payments WHERE workspace_id=$1 ORDER BY external_id",
            [r.workspaceId],
          )
        ).rows;
      });
      api.get(
        "/:workspaceId/payments/:id",
        async (r) =>
          requireValue(
            (
              await db.query(
                "SELECT data FROM payments WHERE workspace_id=$1 AND external_id=$2",
                [r.workspaceId, (r.params as any).id],
              )
            ).rows[0],
          ).data,
      );
      api.post("/:workspaceId/payments/sync", async (r) => {
        owner(r);
        return syncPayments(r.workspaceId);
      });
      api.get("/:workspaceId/workflows/:id/rules", async (r) => {
        const id = uuid.parse((r.params as any).id);
        requireValue(
          (
            await db.query(
              "SELECT id FROM workflow_runs WHERE id=$1 AND workspace_id=$2",
              [id, r.workspaceId],
            )
          ).rows[0],
        );
        return (
          await db.query(
            "SELECT * FROM workflow_rules WHERE run_id=$1 ORDER BY domain",
            [id],
          )
        ).rows;
      });
      api.put("/:workspaceId/workflows/:id/rules/:domain", async (r) => {
        const id = uuid.parse((r.params as any).id);
        const domain = z
          .string()
          .trim()
          .min(1)
          .parse((r.params as any).domain);
        const body = z
          .object({
            approverRole: z.string().trim().min(1),
            informedRoles: z.array(z.string().trim().min(1)).default([]),
            acknowledgmentRoles: z.array(z.string().trim().min(1)).default([]),
          })
          .parse(r.body);
        return transaction(async (c) => {
          // Serialize configuration updates with workflow execution. Existing task
          // assignments retain the policy snapshot captured when they were created.
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
          const run = requireValue(
            (
              await c.query(
                "SELECT * FROM workflow_runs WHERE id=$1 AND workspace_id=$2",
                [id, r.workspaceId],
              )
            ).rows[0],
          );
          if (r.role !== "owner" && run.owner_id !== r.userId)
            throw new AppError(
              403,
              "Workflow creator or workspace owner required",
            );
          if (run.stage === "completed")
            throw new AppError(409, "Completed workflow rules are read-only");
          await c.query(
            "INSERT INTO workflow_rules(run_id,domain,approver_role,informed_roles,acknowledgment_roles) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,domain) DO UPDATE SET approver_role=excluded.approver_role,informed_roles=excluded.informed_roles,acknowledgment_roles=excluded.acknowledgment_roles,version=workflow_rules.version+1",
            [
              id,
              domain,
              body.approverRole,
              body.informedRoles,
              body.acknowledgmentRoles,
            ],
          );
          await c.query(
            "UPDATE workflow_runs SET next_tick=now(),error=NULL WHERE id=$1",
            [id],
          );
          return { ok: true };
        });
      });
      api.post("/:workspaceId/jobs/claim", async (r) =>
        claimJob(r.workspaceId, r.userId),
      );
      api.get(
        "/:workspaceId/jobs",
        async (r) =>
          (
            await db.query(
              "SELECT id,status,error,action,lease_until FROM agent_jobs WHERE workspace_id=$1 AND owner_id=$2 AND status<>'completed'",
              [r.workspaceId, r.userId],
            )
          ).rows,
      );
      api.post("/:workspaceId/jobs/:id/heartbeat", async (r) =>
        heartbeatJob(
          r.workspaceId,
          r.userId,
          uuid.parse((r.params as any).id),
          uuid.parse((r.body as any).lease),
        ),
      );
      api.post("/:workspaceId/jobs/:id/complete", async (r) =>
        completeJob(
          r.workspaceId,
          r.userId,
          uuid.parse((r.params as any).id),
          uuid.parse((r.body as any).lease),
          (r.body as any).result,
        ),
      );
      api.post("/:workspaceId/jobs/:id/fail", async (r) =>
        failJob(
          r.workspaceId,
          r.userId,
          uuid.parse((r.params as any).id),
          uuid.parse((r.body as any).lease),
          z.string().parse((r.body as any).message),
        ),
      );
      api.post("/:workspaceId/jobs/:id/retry", async (r) => {
        await db.query(
          "UPDATE agent_jobs SET status='queued',error=NULL WHERE id=$1 AND workspace_id=$2 AND owner_id=$3 AND status='failed'",
          [uuid.parse((r.params as any).id), r.workspaceId, r.userId],
        );
        return { ok: true };
      });
      api.get(
        "/:workspaceId/activity",
        async (r) =>
          (
            await db.query(
              "SELECT * FROM events WHERE workspace_id=$1 AND (user_id IS NULL OR user_id=$2) ORDER BY id DESC LIMIT 100",
              [r.workspaceId, r.userId],
            )
          ).rows,
      );
      api.get("/:workspaceId/events", async (r, reply) => {
        const cursor = z.coerce
          .number()
          .int()
          .nonnegative()
          .parse((r.query as any).after ?? 0);
        reply.hijack();
        for (const [name, value] of Object.entries(reply.getHeaders()))
          if (value !== undefined) reply.raw.setHeader(name, value);
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        let after = cursor,
          closed = false;
        const until = Date.now() + 55000;
        r.raw.on("close", () => {
          closed = true;
        });
        while (!closed && Date.now() < until) {
          const membership = await db.query(
            "SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2",
            [r.workspaceId, r.userId],
          );
          if (!membership.rowCount) break;
          const events = (
            await db.query(
              "SELECT * FROM events WHERE workspace_id=$1 AND id>$2 AND (user_id IS NULL OR user_id=$3) ORDER BY id LIMIT 100",
              [r.workspaceId, after, r.userId],
            )
          ).rows;
          for (const e of events) {
            reply.raw.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
            after = Number(e.id);
          }
          reply.raw.write(": heartbeat\n\n");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        reply.raw.end();
      });
    },
    { prefix: "/v1" },
  );
  return app;
}
