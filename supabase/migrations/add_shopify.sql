-- Store Shopify store connections per user
CREATE TABLE IF NOT EXISTS shopify_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop TEXT NOT NULL,
  access_token TEXT NOT NULL,
  scope TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, shop)
);

CREATE INDEX IF NOT EXISTS shopify_connections_user_id_idx ON shopify_connections(user_id);
