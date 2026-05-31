-- Custom domain → project mapping. A verified+SSL-provisioned domain
-- serves its linked project's html_content via /api/serve-domain.
--
-- - domain        : globally unique (one project per domain)
-- - verified      : flipped true by /api/domains/[id] GET when DNS A-record
--                   resolves to SERVER_IP
-- - ssl_provisioned : flipped true by scripts/provision-ssl.sh after
--                     certbot issues a cert for the verified domain
--
-- ON DELETE CASCADE from users/projects so deleting a user or project
-- doesn't leave dangling domains pointing at nothing.

CREATE TABLE IF NOT EXISTS custom_domains (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        REFERENCES users(id) ON DELETE CASCADE,
  project_id      UUID        REFERENCES projects(id) ON DELETE CASCADE,
  domain          TEXT        NOT NULL UNIQUE,
  verified        BOOLEAN     DEFAULT FALSE,
  ssl_provisioned BOOLEAN     DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_domains_user_id_idx ON custom_domains(user_id);
CREATE INDEX IF NOT EXISTS custom_domains_project_id_idx ON custom_domains(project_id);
