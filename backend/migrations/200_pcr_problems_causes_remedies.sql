-- PCR (Problem / Cause / Remedy) master data, site-scoped.
-- Kardinalität: 1 Problem : n Ursachen, 1 Ursache : n Maßnahmen.
-- Alle drei Tabellen site-scoped analog zu work_types und anderen Stammdaten.

CREATE TABLE IF NOT EXISTS pcr_problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  key VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT pcr_problems_site_key UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_pcr_problems_site_id ON pcr_problems (site_id);

CREATE TABLE IF NOT EXISTS pcr_causes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  problem_id UUID NOT NULL REFERENCES pcr_problems (id) ON DELETE RESTRICT,
  key VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT pcr_causes_site_key UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_pcr_causes_site_id ON pcr_causes (site_id);
CREATE INDEX IF NOT EXISTS idx_pcr_causes_problem_id ON pcr_causes (problem_id);

CREATE TABLE IF NOT EXISTS pcr_remedies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE RESTRICT,
  cause_id UUID NOT NULL REFERENCES pcr_causes (id) ON DELETE RESTRICT,
  key VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT pcr_remedies_site_key UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_pcr_remedies_site_id ON pcr_remedies (site_id);
CREATE INDEX IF NOT EXISTS idx_pcr_remedies_cause_id ON pcr_remedies (cause_id);
