-- Rollback: remove Google Maps / address columns from assets (see former 010_asset_address).
ALTER TABLE assets DROP COLUMN IF EXISTS address_formatted;
ALTER TABLE assets DROP COLUMN IF EXISTS latitude;
ALTER TABLE assets DROP COLUMN IF EXISTS longitude;
ALTER TABLE assets DROP COLUMN IF EXISTS google_place_id;
