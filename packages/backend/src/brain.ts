import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db } from "./database.js";
import { AppError } from "./errors.js";
export const recordSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  revision: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string(),
  area: z.enum(["temporal", "canonical", "procedures", "context"]),
  kind: z.enum(["adr", "map", "question", "research", "procedure", "context"]),
  sources: z.array(z.string()).default([]),
  data: z.record(z.string(), z.unknown()).optional(),
  approvals: z
    .array(
      z.object({
        userId: z.string(),
        taskId: z.uuid(),
        revision: z.number(),
        role: z.string(),
      }),
    )
    .default([]),
});
export type BrainRecord = z.infer<typeof recordSchema>;
export const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "auto",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: process.env.S3_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      }
    : undefined,
});
const bucket = () => {
  if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET is required");
  return process.env.S3_BUCKET;
};
export function stableId(...parts: string[]) {
  const hex = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
async function keys(prefix: string) {
  let token: string | undefined;
  const result: string[] = [];
  do {
    const page = await storage.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    result.push(
      ...(page.Contents ?? []).flatMap((x) => (x.Key ? [x.Key] : [])),
    );
    token = page.NextContinuationToken;
  } while (token);
  return result;
}
async function readKey(key: string) {
  const object = await storage.send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  return recordSchema.parse(JSON.parse(await object.Body!.transformToString()));
}
export async function readRecord(
  workspaceId: string,
  id: string,
  revision?: number,
) {
  const prefix = `workspaces/${workspaceId}/brain/records/${id}/revisions/`;
  const key = revision
    ? `${prefix}${String(revision).padStart(12, "0")}.json`
    : (await keys(prefix)).sort().at(-1);
  if (!key) throw new AppError(404, "Record not found");
  return readKey(key);
}
export async function history(workspaceId: string, id: string) {
  return Promise.all(
    (await keys(`workspaces/${workspaceId}/brain/records/${id}/revisions/`))
      .sort()
      .map(readKey),
  );
}
export async function indexRecord(record: BrainRecord) {
  await db.query(
    `INSERT INTO brain_index VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,record_id) DO UPDATE SET revision=excluded.revision,area=excluded.area,title=excluded.title,body=excluded.body WHERE brain_index.revision<=excluded.revision`,
    [
      record.workspaceId,
      record.id,
      record.revision,
      record.area,
      record.title,
      record.body,
    ],
  );
}
export async function writeRecord(value: BrainRecord) {
  const record = recordSchema.parse(value);
  const key = `workspaces/${record.workspaceId}/brain/records/${record.id}/revisions/${String(record.revision).padStart(12, "0")}.json`;
  try {
    await storage.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: JSON.stringify(record),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );
  } catch (e) {
    if ((e as { name: string }).name !== "PreconditionFailed") throw e;
    const existing = await readKey(key);
    if (JSON.stringify(existing) !== JSON.stringify(record))
      throw new AppError(409, "Revision already exists with different content");
  }
  await indexRecord(record);
  return record;
}
export async function rebuildIndex(workspaceId: string) {
  const latest = new Map<string, BrainRecord>();
  for (const key of await keys(`workspaces/${workspaceId}/brain/records/`)) {
    if (!key.endsWith(".json")) continue;
    const r = await readKey(key);
    if (!latest.has(r.id) || latest.get(r.id)!.revision < r.revision)
      latest.set(r.id, r);
  }
  for (const record of latest.values()) await indexRecord(record);
  return { indexed: latest.size };
}
