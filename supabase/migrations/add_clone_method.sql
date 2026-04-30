-- Track which cloning method produced each project's HTML:
--   'dom'        — new DOM extraction pipeline (extractor → CSS inliner → asset rehost → html cleaner → Claude Haiku)
--   'screenshot' — existing screenshot + Claude Vision approach (or DOM pipeline fallback)
--   NULL         — projects created before this column was added
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS clone_method text;
