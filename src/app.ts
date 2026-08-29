import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import crypto from "node:crypto";
import { z } from "zod";
import { createSignedUpload } from "./storage.js";
import {
  hashPassword,
  verifyPassword,
  token,
  verify,
  Claims,
  Role,
} from "./security.js";
import { createLocalRepository, FieldDeskRepository } from "./repository.js";
import { buildDispatchPage, classifySla } from "./dispatch.js";

const app = express();
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        (process.env.NODE_ENV !== "production" && corsOrigins.length === 0) ||
        corsOrigins.includes(origin)
      )
        callback(null, true);
      else callback(new Error("origin not allowed"));
    },
  }),
);
app.use(express.json({ limit: "2mb" }));

type A = Request & { user?: Claims };
let repositoryPromise: Promise<FieldDeskRepository> = Promise.resolve(
  createLocalRepository(),
);
export function setRepository(repository: FieldDeskRepository) {
  repositoryPromise = Promise.resolve(repository);
}
export async function getRepository() {
  return repositoryPromise;
}

function auth(req: A, res: Response, next: NextFunction) {
  const h = req.header("authorization");
  if (!h?.startsWith("Bearer "))
    return res.status(401).json({ error: "missing token" });
  try {
    req.user = verify(h.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}
function allow(...roles: Role[]) {
  return (req: A, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: "forbidden" });
    next();
  };
}
async function audit(
  actorId: string,
  action: string,
  jobId: string,
  metadata: unknown = {},
) {
  await (await getRepository()).addAudit({ actorId, action, jobId, metadata });
}

app.get("/health", async (_, res) =>
  res.json({
    service: "fielddesk",
    status: "ok",
    persistence:
      process.env.DB_URL || process.env.SUPABASE_DB_URL ? "postgres" : "sqlite",
  }),
);
const user = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(["dispatcher", "technician", "admin"]).default("technician"),
  tenantId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("default"),
});
app.post("/auth/register", async (req, res) => {
  const p = user.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  try {
    const id = crypto.randomUUID();
    await (
      await getRepository()
    ).createUser({
      id,
      email: p.data.email.toLowerCase(),
      role: p.data.role,
      passwordHash: hashPassword(p.data.password),
      tenantId: p.data.tenantId,
    });
    res.status(201).json({ id, email: p.data.email, role: p.data.role, tenantId: p.data.tenantId });
  } catch {
    res.status(409).json({ error: "email exists" });
  }
});
app.post("/auth/login", async (req, res) => {
  const p = z
    .object({ email: z.string().email(), password: z.string() })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "invalid credentials" });
  const u = await (
    await getRepository()
  ).getUserByEmail(p.data.email.toLowerCase());
  if (!u || !verifyPassword(p.data.password, u.password_hash))
    return res.status(401).json({ error: "invalid credentials" });
  res.json({
    token: token({ sub: u.id, email: u.email, role: u.role, tenantId: u.tenant_id ?? "default" }),
    user: { id: u.id, email: u.email, role: u.role, tenantId: u.tenant_id ?? "default" },
  });
});
const job = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(4000),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  site: z.string().min(2),
  dueAt: z.string().datetime(),
});
app.post("/jobs", auth, allow("dispatcher", "admin"), async (req: A, res) => {
  const p = job.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const id = crypto.randomUUID();
  await (
    await getRepository()
  ).createJob({
    id,
    title: p.data.title,
    description: p.data.description,
    priority: p.data.priority,
    site: p.data.site,
    dueAt: p.data.dueAt,
    createdBy: req.user!.sub,
    tenantId: req.user!.tenantId ?? "default",
  });
  await audit(req.user!.sub, "job.created", id, p.data);
  res.status(201).json({ id, ...p.data, status: "queued" });
});
app.get("/jobs", auth, async (req: A, res) =>
  res.json(
    await (await getRepository()).listJobs(req.user!.role, req.user!.sub, req.user!.tenantId),
  ),
);
app.get("/jobs/dispatch", auth, async (req: A, res) => {
  const repo = await getRepository();
  const jobs = await repo.listJobs(req.user!.role, req.user!.sub, req.user!.tenantId);
  const page = buildDispatchPage(jobs, {
    site: typeof req.query.site === "string" ? req.query.site : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    priority: typeof req.query.priority === "string" ? req.query.priority : undefined,
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 25),
  });
  res.json(page);
});
app.get("/jobs/:id/sla", auth, async (req: A, res) => {
  const job = await (await getRepository()).getJob(String(req.params.id), req.user!.tenantId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const sla = classifySla(job);
  res.json({ jobId: job.id, dueAt: job.due_at, status: job.status, ...sla });
});
app.post(
  "/jobs/:id/assign",
  auth,
  allow("dispatcher", "admin"),
  async (req: A, res) => {
    const p = z.object({ technicianId: z.string() }).safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ error: "technicianId required" });
    const repo = await getRepository();
    const tech = await repo.getTechnician(p.data.technicianId, req.user!.tenantId);
    if (!tech || tech.role !== "technician")
      return res.status(422).json({ error: "user is not a technician" });
    const j = await repo.getJob(String(req.params.id), req.user!.tenantId);
    if (!j) return res.status(404).json({ error: "job not found" });
    if (!["queued", "blocked"].includes(j.status))
      return res
        .status(409)
        .json({ error: "job cannot be assigned in current state" });
    await repo.assignJob(j.id, tech.id);
    await audit(req.user!.sub, "job.assigned", j.id, { technicianId: tech.id });
    res.json({ id: j.id, status: "assigned", assignedTo: tech.id });
  },
);
const transition = z.object({
  status: z.enum(["en_route", "on_site", "blocked", "completed", "cancelled"]),
  note: z.string().max(1000).optional(),
});
app.post("/jobs/:id/status", auth, async (req: A, res) => {
  const p = transition.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const repo = await getRepository();
  const j = await repo.getJob(String(req.params.id), req.user!.tenantId);
  if (!j) return res.status(404).json({ error: "job not found" });
  if (req.user!.role === "technician" && j.assigned_to !== req.user!.sub)
    return res.status(403).json({ error: "not assigned to you" });
  const allowed: Record<string, string[]> = {
    assigned: ["en_route", "cancelled"],
    en_route: ["on_site", "blocked"],
    on_site: ["blocked", "completed"],
    blocked: ["assigned", "cancelled"],
  };
  if (!allowed[j.status]?.includes(p.data.status))
    return res
      .status(409)
      .json({ error: `invalid transition ${j.status} -> ${p.data.status}` });
  if (p.data.status === "completed" && !p.data.note)
    return res.status(422).json({ error: "completion note required" });
  await repo.updateJobStatus(j.id, p.data.status);
  await audit(req.user!.sub, "job.status_changed", j.id, p.data);
  res.json({ id: j.id, status: p.data.status });
});
app.post("/jobs/:id/media/presign", auth, async (req: A, res) => {
  const repo = await getRepository();
  const j = await repo.getJob(String(req.params.id), req.user!.tenantId);
  if (!j) return res.status(404).json({ error: "job not found" });
  if (req.user!.role === "technician" && j.assigned_to !== req.user!.sub)
    return res.status(403).json({ error: "not assigned to you" });
  const p = z
    .object({
      filename: z.string().regex(/^[a-zA-Z0-9._-]+$/),
      contentType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
      sha256: z.string().length(64),
    })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const id = crypto.randomUUID(),
    key = `jobs/${j.id}/${id}-${p.data.filename}`;
  await repo.addMedia({
    id,
    jobId: j.id,
    objectKey: key,
    contentType: p.data.contentType,
    sha256: p.data.sha256,
  });
  try {
    const signed = await createSignedUpload(key, 600);
    res.status(201).json({
      mediaId: id,
      objectKey: key,
      uploadUrl: signed.uploadUrl,
      uploadToken: signed.token,
      expiresIn: signed.expiresIn,
      provider: signed.provider,
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "storage provider unavailable" });
  }
});
app.post("/jobs/:id/media/:mediaId/complete", auth, async (req: A, res) => {
  const repo = await getRepository();
  const m = await repo.getMedia(
    String(req.params.mediaId),
    String(req.params.id),
  );
  if (!m) return res.status(404).json({ error: "media not found" });
  await repo.markMediaUploaded(m.id, new Date().toISOString());
  await audit(req.user!.sub, "media.uploaded", m.job_id, { mediaId: m.id });
  res.json({ mediaId: m.id, status: "uploaded" });
});
app.get("/audit", auth, allow("dispatcher", "admin"), async (_, res) =>
  res.json(await (await getRepository()).listAudit()),
);
app.get("/outbox", auth, allow("dispatcher", "admin"), async (req, res) =>
  res.json(await (await getRepository()).listOutbox({
    pendingOnly: req.query.pendingOnly !== "false",
    limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
  })),
);
app.post("/outbox/:id/publish", auth, allow("dispatcher", "admin"), async (req, res) => {
  const published = await (await getRepository()).markOutboxPublished(String(req.params.id));
  if (!published) return res.status(404).json({ error: "outbox event not found or already published" });
  res.status(204).send();
});
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
export default app;
