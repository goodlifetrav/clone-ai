-- Hot-path indexes flagged in the pre-launch DB review. Each of these
-- columns is hit on every dashboard load, chat exchange, or Stripe
-- webhook; without them postgres falls back to sequential scans which
-- get pathological once the relevant table crosses ~10k rows.
--
-- All CREATE INDEX IF NOT EXISTS, so re-running is a no-op.
-- Built without CONCURRENTLY because the tables are still small and a
-- brief lock at deploy time is cheaper than the migration complexity.

CREATE INDEX IF NOT EXISTS projects_user_id_idx
  ON projects(user_id);

CREATE INDEX IF NOT EXISTS chat_messages_project_id_idx
  ON chat_messages(project_id);

CREATE INDEX IF NOT EXISTS project_versions_project_id_idx
  ON project_versions(project_id);

CREATE INDEX IF NOT EXISTS users_email_idx
  ON users(email);

CREATE INDEX IF NOT EXISTS users_stripe_customer_id_idx
  ON users(stripe_customer_id);
