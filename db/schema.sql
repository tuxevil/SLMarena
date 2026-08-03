CREATE TABLE IF NOT EXISTS scenarios (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  system_prompt TEXT NOT NULL,
  user_messages JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  ollama_url TEXT NOT NULL,
  evaluator_base_url TEXT,
  evaluator_model TEXT,
  evaluator_api_key_encrypted TEXT,
  parameters_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS parameters_json JSONB;

CREATE TABLE IF NOT EXISTS test_runs (
  id UUID PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  control_version BIGINT NOT NULL DEFAULT 0,
  scenario_id UUID,
  samples_per_model SMALLINT NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL,
  ollama_url TEXT NOT NULL,
  user_messages JSONB NOT NULL,
  selected_models JSONB NOT NULL,
  parameters JSONB NOT NULL,
  evaluator_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS ollama_url TEXT NOT NULL DEFAULT '';
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS evaluator_config JSONB;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS control_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS scenario_id UUID;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS samples_per_model SMALLINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS model_results (
  id UUID PRIMARY KEY,
  test_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  model_name VARCHAR(255) NOT NULL,
  sample_index INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  eval_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  response_text TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  ttft_ms INTEGER,
  tok_per_sec DOUBLE PRECISION,
  total_duration_ms INTEGER,
  error_message TEXT,
  human_status VARCHAR(32) NOT NULL DEFAULT 'UNREVIEWED',
  human_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (test_run_id, model_name, sample_index)
);

ALTER TABLE model_results DROP CONSTRAINT IF EXISTS model_results_test_run_id_model_name_key;
ALTER TABLE model_results ADD COLUMN IF NOT EXISTS sample_index INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS model_result_turns (
  id UUID PRIMARY KEY,
  model_result_id UUID NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  user_message TEXT NOT NULL,
  response_text TEXT NOT NULL,
  thinking TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER,
  output_tokens INTEGER,
  ttft_ms INTEGER,
  tok_per_sec DOUBLE PRECISION,
  total_duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (model_result_id, step_order)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY,
  model_result_id UUID NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
  evaluator_model VARCHAR(255) NOT NULL,
  grammar_rating INTEGER CHECK (grammar_rating BETWEEN 1 AND 5),
  compliance_rating INTEGER CHECK (compliance_rating BETWEEN 1 AND 5),
  accuracy_rating INTEGER CHECK (accuracy_rating BETWEEN 1 AND 5),
  score_stars INTEGER CHECK (score_stars BETWEEN 1 AND 5),
  grammar_analysis TEXT,
  compliance_analysis TEXT,
  accuracy_analysis TEXT,
  feedback_text TEXT,
  evaluator_raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS test_runs_created_at_idx ON test_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS model_results_model_name_idx ON model_results (model_name);
CREATE INDEX IF NOT EXISTS model_results_score_idx ON model_results (status, human_status);
