-- Idempotency table for Stripe webhook events.
-- Stripe retries webhooks on non-2xx; without dedupe the same event can fire
-- handlers twice (double-applying a token-pack purchase, for example).
-- We insert the event id at the top of the handler; ON CONFLICT means we've
-- already processed it and can return 200 immediately.
CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
