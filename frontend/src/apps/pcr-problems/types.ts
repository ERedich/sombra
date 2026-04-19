export type PcrProblem = {
  id: string
  site_id: string
  key: string
  name: string
  description: string | null
  site_key: string
  site_name: string
  site_colour: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

export type PcrCause = {
  id: string
  site_id: string
  problem_id: string
  key: string
  name: string
  description: string | null
  site_key: string
  site_name: string
  site_colour: string
  problem_key: string
  problem_name: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

export type PcrRemedy = {
  id: string
  site_id: string
  cause_id: string
  key: string
  name: string
  description: string | null
  site_key: string
  site_name: string
  site_colour: string
  cause_key: string
  cause_name: string
  problem_id: string
  problem_key: string
  problem_name: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}
