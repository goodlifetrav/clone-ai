-- Add status column to projects table for background processing support.
-- Run this once in the Supabase SQL editor before deploying the background
-- processing changes.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete'
    CHECK (status IN ('processing', 'complete', 'error'));

-- Back-fill existing rows (all existing projects are already complete)
UPDATE projects SET status = 'complete' WHERE status IS NULL;
