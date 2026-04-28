-- Scrape cache: reuse recent scrapes of the same URL to save bandwidth and time
CREATE TABLE IF NOT EXISTS scrape_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  html TEXT NOT NULL,
  screenshot_base64 TEXT NOT NULL,
  title TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scrape_cache_url_idx ON scrape_cache(url);
CREATE INDEX IF NOT EXISTS scrape_cache_scraped_at_idx ON scrape_cache(scraped_at);
