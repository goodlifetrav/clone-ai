-- Columns the code already reads/writes on users but that never had a
-- migration file in source. Captured here so a fresh deploy matches prod.
--
-- - is_admin             : referenced in lib/admin.ts + multiple routes
-- - stripe_customer_id   : webhook lookups + checkout flow
-- - billing_period_start : reset on invoice.payment_succeeded; gates per-period
--                          usage counters in lib/quotas / api/clone / chat
--
-- CREATE INDEX IF NOT EXISTS for stripe_customer_id is in
-- add_hot_path_indexes.sql; not duplicated here.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS billing_period_start TIMESTAMPTZ;
