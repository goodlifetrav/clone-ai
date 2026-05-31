-- Cached brand profile per folder. Populated after the first homepage
-- Brand Rebuild so subsequent sibling-page rebuilds (product, collection,
-- cart, etc.) inherit the same brand without re-prompting the user.
--
-- Referenced in app/api/chat/route.ts and
-- app/api/projects/[id]/rebuild/route.ts.

ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS brand_profile JSONB;
