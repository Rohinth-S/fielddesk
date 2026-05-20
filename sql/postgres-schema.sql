-- Managed Supabase Postgres schema for FieldDesk.
-- The API connects with a server-side service role; RLS remains enabled as defense in depth.
CREATE TABLE IF NOT EXISTS fielddesk_users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, role text NOT NULL CHECK (role IN ('dispatcher','technician','admin')), password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fielddesk_jobs (id uuid PRIMARY KEY, title text NOT NULL, description text NOT NULL, priority text NOT NULL, site text NOT NULL, status text NOT NULL, assigned_to uuid REFERENCES fielddesk_users(id), due_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES fielddesk_users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fielddesk_media (id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES fielddesk_jobs(id), object_key text NOT NULL, content_type text NOT NULL, sha256 text NOT NULL, uploaded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fielddesk_audit (id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL, job_id uuid NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE fielddesk_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_audit ENABLE ROW LEVEL SECURITY;

