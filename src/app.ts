import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "./db.js";
import {
  hashPassword,
  verifyPassword,
  token,
  verify,
  Claims,
  Role,
} from "./security.js";
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
function audit(actor: string, action: string, job: string, meta: unknown = {}) {
  db.prepare("INSERT INTO audit VALUES (?,?,?,?,?,?)").run(
    crypto.randomUUID(),
    actor,
    action,
    job,
    JSON.stringify(meta),
    new Date().toISOString(),
  );
}
app.get("/health", (_, res) =>
  res.json({ service: "fielddesk", status: "ok" }),
);
const user = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(["dispatcher", "technician", "admin"]).default("technician"),
});
app.post("/auth/register", (req, res) => {
  const p = user.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const id = crypto.randomUUID();
  try {
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(
      id,
      p.data.email.toLowerCase(),
      p.data.role,
      hashPassword(p.data.password),
      new Date().toISOString(),
    );
    res.status(201).json({ id, email: p.data.email, role: p.data.role });
  } catch {
    res.status(409).json({ error: "email exists" });
  }
});
app.post("/auth/login", (req, res) => {
  const p = z
    .object({ email: z.string().email(), password: z.string() })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "invalid credentials" });
  const u = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(p.data.email.toLowerCase()) as any;
  if (!u || !verifyPassword(p.data.password, u.password_hash))
    return res.status(401).json({ error: "invalid credentials" });
  res.json({
    token: token({ sub: u.id, email: u.email, role: u.role }),
    user: { id: u.id, email: u.email, role: u.role },
  });
});
const job = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(4000),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  site: z.string().min(2),
  dueAt: z.string().datetime(),
});
app.post("/jobs", auth, allow("dispatcher", "admin"), (req: A, res) => {
  const p = job.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    id,
    p.data.title,
    p.data.description,
    p.data.priority,
    p.data.site,
    "queued",
    null,
    p.data.dueAt,
    req.user!.sub,
    new Date().toISOString(),
  );
  audit(req.user!.sub, "job.created", id, p.data);
  res.status(201).json({ id, ...p.data, status: "queued" });
});
app.get("/jobs", auth, (req: A, res) => {
  const rows =
    req.user!.role === "technician"
      ? db
          .prepare(
            "SELECT * FROM jobs WHERE assigned_to=? OR assigned_to IS NULL ORDER BY due_at",
          )
          .all(req.user!.sub)
      : db.prepare("SELECT * FROM jobs ORDER BY due_at").all();
  res.json(rows);
});
app.post(
  "/jobs/:id/assign",
  auth,
  allow("dispatcher", "admin"),
  (req: A, res) => {
    const p = z.object({ technicianId: z.string() }).safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ error: "technicianId required" });
    const tech = db
      .prepare("SELECT id,role FROM users WHERE id=?")
      .get(p.data.technicianId) as any;
    if (!tech || tech.role !== "technician")
      return res.status(422).json({ error: "user is not a technician" });
    const j = db
      .prepare("SELECT * FROM jobs WHERE id=?")
      .get(req.params.id) as any;
    if (!j) return res.status(404).json({ error: "job not found" });
    if (!["queued", "blocked"].includes(j.status))
      return res
        .status(409)
        .json({ error: "job cannot be assigned in current state" });
    db.prepare(
      "UPDATE jobs SET assigned_to=?,status='assigned' WHERE id=?",
    ).run(tech.id, j.id);
    audit(req.user!.sub, "job.assigned", j.id, { technicianId: tech.id });
    res.json({ id: j.id, status: "assigned", assignedTo: tech.id });
  },
);
const transition = z.object({
  status: z.enum(["en_route", "on_site", "blocked", "completed", "cancelled"]),
  note: z.string().max(1000).optional(),
});
app.post("/jobs/:id/status", auth, (req: A, res) => {
  const p = transition.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const j = db
    .prepare("SELECT * FROM jobs WHERE id=?")
    .get(req.params.id) as any;
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
  db.prepare("UPDATE jobs SET status=? WHERE id=?").run(p.data.status, j.id);
  audit(req.user!.sub, "job.status_changed", j.id, p.data);
  res.json({ id: j.id, status: p.data.status });
});
app.post("/jobs/:id/media/presign", auth, (req: A, res) => {
  const j = db
    .prepare("SELECT * FROM jobs WHERE id=?")
    .get(req.params.id) as any;
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
  db.prepare("INSERT INTO media VALUES (?,?,?,?,?,?,?)").run(
    id,
    j.id,
    key,
    p.data.contentType,
    p.data.sha256,
    null,
    new Date().toISOString(),
  );
  res
    .status(201)
    .json({
      mediaId: id,
      objectKey: key,
      uploadUrl: `https://s3.local/${key}`,
      expiresIn: 600,
    });
});
app.post("/jobs/:id/media/:mediaId/complete", auth, (req: A, res) => {
  const m = db
    .prepare("SELECT * FROM media WHERE id=? AND job_id=?")
    .get(req.params.mediaId, req.params.id) as any;
  if (!m) return res.status(404).json({ error: "media not found" });
  db.prepare("UPDATE media SET uploaded_at=? WHERE id=?").run(
    new Date().toISOString(),
    m.id,
  );
  audit(req.user!.sub, "media.uploaded", m.job_id, { mediaId: m.id });
  res.json({ mediaId: m.id, status: "uploaded" });
});
app.get("/audit", auth, allow("dispatcher", "admin"), (req, res) =>
  res.json(
    db.prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT 200").all(),
  ),
);
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
export default app;
