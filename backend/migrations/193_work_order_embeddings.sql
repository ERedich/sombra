-- pgvector-backed embeddings for "similar work orders" search.
-- Scoped by site_id so multi-tenant queries stay isolated. source_hash lets
-- the upsert path skip re-embedding when the canonical text has not changed.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS work_order_embeddings (
  work_order_id UUID PRIMARY KEY
    REFERENCES work_orders (id) ON DELETE CASCADE,
  site_id       UUID NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  model         TEXT NOT NULL,
  source_hash   TEXT NOT NULL,
  embedding     vector(1536) NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wo_emb_site
  ON work_order_embeddings (site_id);

-- ANN index for cosine distance. `lists` is a starting value; revisit once
-- row count is known (rule of thumb: lists ~= sqrt(rows)).
CREATE INDEX IF NOT EXISTS idx_wo_emb_ann
  ON work_order_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
