-- Managed Supabase Postgres schema for FieldDesk.
-- The API connects with a server-side service role; RLS remains enabled as defense in depth.
CREATE TABLE IF NOT EXISTS fielddesk_users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, role text NOT NULL CHECK (role IN ('dispatcher','technician','admin')), password_hash text NOT NULL, tenant_id text NOT NULL DEFAULT 'default', created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE fielddesk_users ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';
CREATE TABLE IF NOT EXISTS fielddesk_jobs (id uuid PRIMARY KEY, title text NOT NULL, description text NOT NULL, priority text NOT NULL, site text NOT NULL, status text NOT NULL, assigned_to uuid REFERENCES fielddesk_users(id), due_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES fielddesk_users(id), tenant_id text NOT NULL DEFAULT 'default', created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE fielddesk_jobs ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';
CREATE TABLE IF NOT EXISTS fielddesk_media (id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES fielddesk_jobs(id), object_key text NOT NULL, content_type text NOT NULL, sha256 text NOT NULL, uploaded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fielddesk_audit (id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES fielddesk_users(id), action text NOT NULL, job_id uuid NOT NULL REFERENCES fielddesk_jobs(id), metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fielddesk_outbox (id uuid PRIMARY KEY, topic text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz);
CREATE INDEX IF NOT EXISTS fielddesk_outbox_pending_idx ON fielddesk_outbox(published_at, created_at);
ALTER TABLE fielddesk_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE fielddesk_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON fielddesk_users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_full_access ON fielddesk_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_full_access ON fielddesk_media FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_full_access ON fielddesk_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_full_access ON fielddesk_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);

