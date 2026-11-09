# FieldDesk operations: migration order

## Purpose

This runbook records the production contract for FieldDesk's dispatcher, technician, job, media, and audit workflows. It is intentionally concrete so a reviewer can trace an operational decision back to the API and the Supabase schema.

## Checks

- Confirm the relevant request is authenticated and validated before it reaches the repository.
- Confirm the route uses the repository interface rather than reaching SQLite or Postgres directly.
- Inspect the service health response, structured logs, and the latest audit event before changing data.
- Use the checked-in sql/postgres-schema.sql migration for managed environments and keep POSTGRES_ROUTES_ENABLED=true explicit.

## Failure handling

Stop the rollout when the check above fails, preserve the request correlation identifier, and record the observed state before retrying. Prefer a bounded retry or rollback over changing persisted job state manually.

## Verification

Run 
pm test, 
pm run lint, and 
pm run build after changing this contract. Production verification must include a dispatcher job creation, technician assignment, status transition, signed media upload, and audit read.
