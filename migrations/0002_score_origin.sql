-- Who submitted each score, so the admin can spot bots and repeat cheaters. Apply once, after 0001:
--   npx wrangler d1 execute <database-name> --remote --file=migrations/0002_score_origin.sql
-- Scores saved before this migration keep NULL in every new column.
ALTER TABLE scores ADD COLUMN ip TEXT;
ALTER TABLE scores ADD COLUMN country TEXT;
ALTER TABLE scores ADD COLUMN asn INTEGER;
ALTER TABLE scores ADD COLUMN user_agent TEXT;
-- Extra Cloudflare request details as JSON (network name, city, region, timezone, data center, TLS).
ALTER TABLE scores ADD COLUMN request_meta TEXT;
-- SHA-256 of the browser signals below, computed by the server; NULL when the browser sent none.
ALTER TABLE scores ADD COLUMN fingerprint TEXT;
-- The raw browser signals as canonical JSON (scripts/fingerprint.js).
ALTER TABLE scores ADD COLUMN fingerprint_data TEXT;
CREATE INDEX IF NOT EXISTS scores_by_fingerprint ON scores (fingerprint);
CREATE INDEX IF NOT EXISTS scores_by_ip ON scores (ip);
