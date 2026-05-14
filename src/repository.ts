import { Pool } from "pg";
import crypto from "node:crypto";
import { db } from "./db.js";

export type UserRole = "dispatcher" | "technician" | "admin";
export type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  password_hash: string;
};
export type JobRow = {
  id: string;
  title: string;
  description: string;
  priority: string;
  site: string;
  status: string;
  assigned_to: string | null;
  due_at: string;
  created_by: string;
  created_at: string;
};
export type MediaRow = {
  id: string;
  job_id: string;
  object_key: string;
  content_type: string;
  sha256: string;
  uploaded_at: string | null;
  created_at: string;
};
export type QueryExecutor = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};

export interface FieldDeskRepository {
  createUser(input: {
    id: string;
    email: string;
    role: UserRole;
    passwordHash: string;
  }): Promise<void>;
  getUserByEmail(email: string): Promise<UserRow | undefined>;
  getTechnician(
    id: string,
  ): Promise<{ id: string; role: UserRole } | undefined>;
  createJob(input: {
    id: string;
    title: string;
    description: string;
    priority: string;
    site: string;
    dueAt: string;
    createdBy: string;
  }): Promise<void>;
  listJobs(role: UserRole, userId: string): Promise<JobRow[]>;
  getJob(id: string): Promise<JobRow | undefined>;
  assignJob(id: string, technicianId: string): Promise<void>;
  updateJobStatus(id: string, status: string): Promise<void>;
  addMedia(input: {
    id: string;
    jobId: string;
    objectKey: string;
    contentType: string;
    sha256: string;
  }): Promise<void>;
  getMedia(id: string, jobId: string): Promise<MediaRow | undefined>;
  markMediaUploaded(id: string, at: string): Promise<void>;
  addAudit(input: {
    actorId: string;
    action: string;
    jobId: string;
    metadata: unknown;
  }): Promise<void>;
  listAudit(): Promise<any[]>;
  close(): Promise<void>;
}

class LocalRepository implements FieldDeskRepository {
  async createUser(input: {
    id: string;
    email: string;
    role: UserRole;
    passwordHash: string;
  }) {
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(
      input.id,
      input.email,
      input.role,
      input.passwordHash,
      new Date().toISOString(),
    );
  }
  async getUserByEmail(email: string) {
    return db
      .prepare("SELECT id,email,role,password_hash FROM users WHERE email=?")
      .get(email) as UserRow | undefined;
  }
  async getTechnician(id: string) {
    return db.prepare("SELECT id,role FROM users WHERE id=?").get(id) as
      | { id: string; role: UserRole }
      | undefined;
  }
  async createJob(i: {
    id: string;
    title: string;
    description: string;
    priority: string;
    site: string;
    dueAt: string;
    createdBy: string;
  }) {
    db.prepare("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      i.id,
      i.title,
      i.description,
      i.priority,
      i.site,
      "queued",
      null,
      i.dueAt,
      i.createdBy,
      new Date().toISOString(),
    );
  }
  async listJobs(role: UserRole, userId: string) {
    return (
      role === "technician"
        ? db
            .prepare(
              "SELECT * FROM jobs WHERE assigned_to=? OR assigned_to IS NULL ORDER BY due_at",
            )
            .all(userId)
        : db.prepare("SELECT * FROM jobs ORDER BY due_at").all()
    ) as JobRow[];
  }
  async getJob(id: string) {
    return db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      | JobRow
      | undefined;
  }
  async assignJob(id: string, technicianId: string) {
    db.prepare(
      "UPDATE jobs SET assigned_to=?,status='assigned' WHERE id=?",
    ).run(technicianId, id);
  }
  async updateJobStatus(id: string, status: string) {
    db.prepare("UPDATE jobs SET status=? WHERE id=?").run(status, id);
  }
  async addMedia(i: {
    id: string;
    jobId: string;
    objectKey: string;
    contentType: string;
    sha256: string;
  }) {
    db.prepare("INSERT INTO media VALUES (?,?,?,?,?,?,?)").run(
      i.id,
      i.jobId,
      i.objectKey,
      i.contentType,
      i.sha256,
      null,
      new Date().toISOString(),
    );
  }
  async getMedia(id: string, jobId: string) {
    return db
      .prepare("SELECT * FROM media WHERE id=? AND job_id=?")
      .get(id, jobId) as MediaRow | undefined;
  }
  async markMediaUploaded(id: string, at: string) {
    db.prepare("UPDATE media SET uploaded_at=? WHERE id=?").run(at, id);
  }
  async addAudit(i: {
    actorId: string;
    action: string;
    jobId: string;
    metadata: unknown;
  }) {
    db.prepare("INSERT INTO audit VALUES (?,?,?,?,?,?)").run(
      crypto.randomUUID(),
      i.actorId,
      i.action,
      i.jobId,
      JSON.stringify(i.metadata),
      new Date().toISOString(),
    );
  }
  async listAudit() {
    return db
      .prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT 200")
      .all();
  }
  async close() {}
}

class PostgresRepository implements FieldDeskRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly pool?: Pool,
  ) {}
  async createUser(i: {
    id: string;
    email: string;
    role: UserRole;
    passwordHash: string;
  }) {
    await this.executor.query(
      "INSERT INTO fielddesk_users (id,email,role,password_hash,created_at) VALUES ($1,$2,$3,$4,NOW())",
      [i.id, i.email, i.role, i.passwordHash],
    );
  }
  async getUserByEmail(email: string) {
    const r = await this.executor.query(
      "SELECT id,email,role,password_hash FROM fielddesk_users WHERE email=$1",
      [email],
    );
    return r.rows[0] as UserRow | undefined;
  }
  async getTechnician(id: string) {
    const r = await this.executor.query(
      "SELECT id,role FROM fielddesk_users WHERE id=$1",
      [id],
    );
    return r.rows[0] as { id: string; role: UserRole } | undefined;
  }
  async createJob(i: {
    id: string;
    title: string;
    description: string;
    priority: string;
    site: string;
    dueAt: string;
    createdBy: string;
  }) {
    await this.executor.query(
      "INSERT INTO fielddesk_jobs (id,title,description,priority,site,status,assigned_to,due_at,created_by,created_at) VALUES ($1,$2,$3,$4,$5,'queued',NULL,$6,$7,NOW())",
      [i.id, i.title, i.description, i.priority, i.site, i.dueAt, i.createdBy],
    );
  }
  async listJobs(role: UserRole, userId: string) {
    const r =
      role === "technician"
        ? await this.executor.query(
            "SELECT * FROM fielddesk_jobs WHERE assigned_to=$1 OR assigned_to IS NULL ORDER BY due_at",
            [userId],
          )
        : await this.executor.query(
            "SELECT * FROM fielddesk_jobs ORDER BY due_at",
          );
    return r.rows as JobRow[];
  }
  async getJob(id: string) {
    const r = await this.executor.query(
      "SELECT * FROM fielddesk_jobs WHERE id=$1",
      [id],
    );
    return r.rows[0] as JobRow | undefined;
  }
  async assignJob(id: string, technicianId: string) {
    await this.executor.query(
      "UPDATE fielddesk_jobs SET assigned_to=$1,status='assigned' WHERE id=$2",
      [technicianId, id],
    );
  }
  async updateJobStatus(id: string, status: string) {
    await this.executor.query(
      "UPDATE fielddesk_jobs SET status=$1 WHERE id=$2",
      [status, id],
    );
  }
  async addMedia(i: {
    id: string;
    jobId: string;
    objectKey: string;
    contentType: string;
    sha256: string;
  }) {
    await this.executor.query(
      "INSERT INTO fielddesk_media (id,job_id,object_key,content_type,sha256,uploaded_at,created_at) VALUES ($1,$2,$3,$4,$5,NULL,NOW())",
      [i.id, i.jobId, i.objectKey, i.contentType, i.sha256],
    );
  }
  async getMedia(id: string, jobId: string) {
    const r = await this.executor.query(
      "SELECT * FROM fielddesk_media WHERE id=$1 AND job_id=$2",
      [id, jobId],
    );
    return r.rows[0] as MediaRow | undefined;
  }
  async markMediaUploaded(id: string, at: string) {
    await this.executor.query(
      "UPDATE fielddesk_media SET uploaded_at=$1 WHERE id=$2",
      [at, id],
    );
  }
  async addAudit(i: {
    actorId: string;
    action: string;
    jobId: string;
    metadata: unknown;
  }) {
    await this.executor.query(
      "INSERT INTO fielddesk_audit (id,actor_id,action,job_id,metadata,created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
      [
        crypto.randomUUID(),
        i.actorId,
        i.action,
        i.jobId,
        JSON.stringify(i.metadata),
      ],
    );
  }
  async listAudit() {
    const r = await this.executor.query(
      "SELECT * FROM fielddesk_audit ORDER BY created_at DESC LIMIT 200",
    );
    return r.rows;
  }
  async close() {
    await this.pool?.end();
  }
}

const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS fielddesk_users (id UUID PRIMARY KEY,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS fielddesk_jobs (id UUID PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,site TEXT NOT NULL,assigned_to UUID REFERENCES fielddesk_users(id),due_at TIMESTAMPTZ NOT NULL,created_by UUID NOT NULL REFERENCES fielddesk_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS fielddesk_media (id UUID PRIMARY KEY,job_id UUID NOT NULL REFERENCES fielddesk_jobs(id),object_key TEXT NOT NULL,content_type TEXT NOT NULL,sha256 TEXT NOT NULL,uploaded_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS fielddesk_audit (id UUID PRIMARY KEY,actor_id UUID NOT NULL,action TEXT NOT NULL,job_id UUID NOT NULL,metadata JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE fielddesk_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_audit ENABLE ROW LEVEL SECURITY;`;

export function createLocalRepository(): FieldDeskRepository {
  return new LocalRepository();
}
export function createPostgresRepositoryFromExecutor(executor: QueryExecutor) {
  return new PostgresRepository(executor);
}
export async function createRepository(): Promise<FieldDeskRepository> {
  const connectionString = process.env.DB_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) return new LocalRepository();
  const pool = new Pool({
    connectionString,
    ssl:
      process.env.PGSSLMODE === "disable"
        ? undefined
        : { rejectUnauthorized: false },
    max: 10,
  });
  await pool.query(POSTGRES_SCHEMA);
  return new PostgresRepository(pool, pool);
}
