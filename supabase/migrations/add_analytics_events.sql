-- Lightweight analytics for the admin dashboard. Written by /api/analytics
-- on visit/signup/conversion events, read by /api/admin/stats to power the
-- Signups-by-Source panel.
--
-- user_id is text (not uuid) because the column is populated from the
-- iron-session whopUserId / clerk_id, which is a string identifier — not
-- our internal users.id UUID. Foreign key omitted on purpose so analytics
-- write paths don't fail when the user row is missing or being created.
--
-- country is the 2-letter ISO code resolved server-side from the request
-- IP via ip-api.com; null when geolocation fails.

CREATE TABLE IF NOT EXISTS analytics_events (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  event_type   TEXT        NOT NULL,
  page         TEXT,
  referrer     TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  user_id      TEXT,
  country      TEXT
);

CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
  ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_type_idx
  ON analytics_events(event_type);
