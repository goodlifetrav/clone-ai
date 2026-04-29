-- Track free-tier usage explicitly so limits can be checked with a single
-- column read instead of counting rows in other tables.
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_clones_used integer DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_chats_used  integer DEFAULT 0;
