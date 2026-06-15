-- ============================================================================
-- Schema for Architecture Modelling Tool
-- Supports multiple named "files" via model_files table
-- All IDs are TEXT to match frontend string IDs
-- JSONB used for complex nested objects (styles, edge_points, etc.)
-- ============================================================================

-- Core "file" concept - each model_file is a named container
CREATE TABLE model_files (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL UNIQUE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  tags         TEXT
);

-- ============================================================================
-- BUSINESS DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE business_users (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT
);

CREATE TABLE business_processes (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE process_activities (
  id                     TEXT PRIMARY KEY,
  model_file_id          TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  business_process_id    TEXT NOT NULL REFERENCES business_processes(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  description            TEXT,
  sequence_order         INTEGER,
  frequency              TEXT,
  actor_hint             TEXT NOT NULL,
  user_interaction_level TEXT NOT NULL,
  tags                   TEXT,
  valid_from             TEXT,
  valid_to               TEXT
);

CREATE TABLE business_points (
  id                  TEXT PRIMARY KEY,
  model_file_id       TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  kind                TEXT NOT NULL,
  business_process_id TEXT NOT NULL REFERENCES business_processes(id),
  process_activity_id TEXT REFERENCES process_activities(id),
  tags                TEXT,
  valid_from          TEXT,
  valid_to            TEXT
);

-- ============================================================================
-- APPLICATION DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE applications (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  app_type       TEXT,
  status         TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE application_components (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE services (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_id           TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  application_component_id TEXT REFERENCES application_components(id),
  name                     TEXT NOT NULL,
  description              TEXT,
  service_type             TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT
);

CREATE TABLE interfaces (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  service_id     TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  interface_type TEXT,
  spec_link      TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE endpoints (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  interface_id       TEXT NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  endpoint_type      TEXT,
  path_or_address    TEXT,
  protocol           TEXT,
  operation_verb     TEXT,
  direction          TEXT,
  lifecycle_status   TEXT,
  version            TEXT,
  tags               TEXT,
  valid_from         TEXT,
  valid_to           TEXT
);

CREATE TABLE application_points (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  kind                     TEXT NOT NULL,
  application_id           TEXT NOT NULL REFERENCES applications(id),
  application_component_id TEXT REFERENCES application_components(id),
  service_id               TEXT REFERENCES services(id),
  interface_id             TEXT REFERENCES interfaces(id),
  point_type               TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT
);

-- ============================================================================
-- DATA DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE logical_data_entities (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE logical_data_attributes (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  logical_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  data_type          TEXT,
  is_primary_key     BOOLEAN NOT NULL DEFAULT FALSE,
  is_nullable        BOOLEAN NOT NULL DEFAULT TRUE,
  tags               TEXT
);

CREATE TABLE physical_data_entities (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  physical_type  TEXT,
  database_name  TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE physical_data_attributes (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  physical_entity_id   TEXT NOT NULL REFERENCES physical_data_entities(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  data_type            TEXT,
  is_primary_key       BOOLEAN NOT NULL DEFAULT FALSE,
  is_nullable          BOOLEAN NOT NULL DEFAULT TRUE,
  tags                 TEXT
);

-- ============================================================================
-- INTERACTION DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE app_business_points (
  id               TEXT PRIMARY KEY,
  model_file_id    TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  tags             TEXT,
  valid_from       TEXT,
  valid_to         TEXT
);

CREATE TABLE interactions (
  id                              TEXT PRIMARY KEY,
  model_file_id                   TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                            TEXT NOT NULL,
  description                     TEXT,
  user_id                         TEXT REFERENCES business_users(id),
  primary_app_business_point_id   TEXT NOT NULL REFERENCES app_business_points(id),
  secondary_app_business_point_id TEXT REFERENCES app_business_points(id)
);

-- ============================================================================
-- RELATIONSHIP TABLES
-- ============================================================================

CREATE TABLE business_user_business_points (
  id                TEXT PRIMARY KEY,
  model_file_id     TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  business_user_id  TEXT NOT NULL REFERENCES business_users(id),
  business_point_id TEXT NOT NULL REFERENCES business_points(id),
  description       TEXT,
  tags              TEXT,
  valid_from        TEXT,
  valid_to          TEXT
);

CREATE TABLE application_point_business_points (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_point_id TEXT NOT NULL REFERENCES application_points(id),
  business_point_id    TEXT NOT NULL REFERENCES business_points(id),
  description          TEXT,
  tags                 TEXT,
  valid_from           TEXT,
  valid_to             TEXT
);

CREATE TABLE logical_data_entity_relationships (
  id                TEXT PRIMARY KEY,
  model_file_id     TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  source_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id),
  target_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id),
  relationship_type TEXT NOT NULL,
  description       TEXT,
  tags              TEXT,
  valid_from        TEXT,
  valid_to          TEXT
);

CREATE TABLE logical_data_entity_physical_data_entities (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  logical_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id),
  physical_entity_id TEXT NOT NULL REFERENCES physical_data_entities(id),
  description        TEXT,
  tags               TEXT,
  valid_from         TEXT,
  valid_to           TEXT
);

CREATE TABLE logical_data_attribute_physical_data_attributes (
  id                    TEXT PRIMARY KEY,
  model_file_id         TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  logical_attribute_id  TEXT NOT NULL REFERENCES logical_data_attributes(id),
  physical_attribute_id TEXT NOT NULL REFERENCES physical_data_attributes(id),
  description           TEXT,
  tags                  TEXT,
  valid_from            TEXT,
  valid_to              TEXT
);

CREATE TABLE data_movements (
  id                          TEXT PRIMARY KEY,
  model_file_id               TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  source_application_point_id TEXT NOT NULL REFERENCES application_points(id),
  target_application_point_id TEXT NOT NULL REFERENCES application_points(id),
  data_entity_id              TEXT,
  movement_type               TEXT,
  description                 TEXT,
  tags                        TEXT,
  valid_from                  TEXT,
  valid_to                    TEXT
);

CREATE TABLE interface_logical_entities (
  id                TEXT PRIMARY KEY,
  model_file_id     TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  interface_id      TEXT NOT NULL REFERENCES interfaces(id),
  logical_entity_id TEXT NOT NULL REFERENCES logical_data_entities(id),
  description       TEXT,
  tags              TEXT,
  valid_from        TEXT,
  valid_to          TEXT
);

-- ============================================================================
-- DIAGRAM TABLES
-- ============================================================================

CREATE TABLE diagrams (
  id            TEXT PRIMARY KEY,
  model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  diagram_type  TEXT,
  settings      JSONB,
  view_quarter  TEXT
);

CREATE TABLE diagram_nodes (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id               TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  entity_type              TEXT NOT NULL,
  entity_id                TEXT NOT NULL,
  pos_x                    DOUBLE PRECISION NOT NULL,
  pos_y                    DOUBLE PRECISION NOT NULL,
  width                    DOUBLE PRECISION,
  height                   DOUBLE PRECISION,
  auto_size                BOOLEAN DEFAULT TRUE,
  z_index                  INTEGER DEFAULT 0,
  parent_node_id           TEXT,
  style_override           JSONB,
  text_h_align             TEXT,
  text_v_align             TEXT,
  text_area_width          DOUBLE PRECISION,
  text_font_size           TEXT,
  text_font_weight         TEXT,
  text_font_style          TEXT,
  text_text_decoration     TEXT,
  background_color         TEXT,
  line_color               TEXT,
  text_color               TEXT,
  render_style             TEXT,
  embedded_attribute_ids   JSONB,
  selected_attribute_ids   JSONB,
  embedded_endpoint_ids    JSONB,
  embedded_entity_ids      JSONB,
  valid_from               TEXT,
  valid_to                 TEXT
);

CREATE TABLE diagram_edges (
  id                  TEXT PRIMARY KEY,
  model_file_id       TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id          TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  relationship_type   TEXT NOT NULL,
  relationship_id     TEXT NOT NULL,
  source_node_id      TEXT NOT NULL,
  target_node_id      TEXT NOT NULL,
  label_text          TEXT,
  label_pos_x         DOUBLE PRECISION,
  label_pos_y         DOUBLE PRECISION,
  line_weight         TEXT,
  line_type           TEXT,
  line_dashes         TEXT,
  arrow_start         TEXT,
  arrow_end           TEXT,
  style_override      JSONB,
  edge_points         JSONB NOT NULL,
  label_font_size     TEXT,
  label_font_weight   TEXT,
  label_font_style    TEXT,
  label_text_decoration TEXT,
  label_h_align       TEXT,
  label_v_align       TEXT,
  line_color          TEXT,
  text_color          TEXT,
  sub_type            TEXT,
  source_label_text   TEXT,
  source_label_pos_x  DOUBLE PRECISION,
  source_label_pos_y  DOUBLE PRECISION,
  target_label_text   TEXT,
  target_label_pos_x  DOUBLE PRECISION,
  target_label_pos_y  DOUBLE PRECISION,
  z_index             INTEGER DEFAULT 110,
  valid_from          TEXT,
  valid_to            TEXT
);

CREATE TABLE diagram_interaction_edges (
  id                     TEXT PRIMARY KEY,
  model_file_id          TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id             TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  interaction_id         TEXT NOT NULL REFERENCES interactions(id),
  relationship_type      TEXT NOT NULL DEFAULT 'USER_INTERACTION',
  source_node_id         TEXT NOT NULL,
  target_node_id         TEXT NOT NULL,
  edge_points            JSONB NOT NULL,
  label_text             TEXT,
  label_pos_x            DOUBLE PRECISION,
  label_pos_y            DOUBLE PRECISION,
  user_node_id           TEXT,
  user_link_edge_points  JSONB,
  line_style             TEXT DEFAULT 'dotted'
);

CREATE TABLE diagram_decorations (
  id               TEXT PRIMARY KEY,
  model_file_id    TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id       TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  decoration_type  TEXT NOT NULL,
  text             TEXT,
  text_font_size   DOUBLE PRECISION,
  text_font_weight TEXT,
  text_font_style  TEXT,
  text_color       TEXT,
  line_color       TEXT,
  line_style       TEXT,
  line_weight      TEXT,
  z_index          INTEGER DEFAULT 0,
  valid_from       TEXT,
  valid_to         TEXT,
  -- Shape decoration fields
  pos_x            DOUBLE PRECISION,
  pos_y            DOUBLE PRECISION,
  width            DOUBLE PRECISION,
  height           DOUBLE PRECISION,
  text_h_align     TEXT,
  text_v_align     TEXT,
  background_color TEXT,
  auto_size        BOOLEAN,
  -- Line decoration fields
  line_points      JSONB,
  label_pos_x      DOUBLE PRECISION,
  label_pos_y      DOUBLE PRECISION,
  arrow_start      TEXT,
  arrow_end        TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_business_users_model_file ON business_users(model_file_id);
CREATE INDEX idx_business_processes_model_file ON business_processes(model_file_id);
CREATE INDEX idx_process_activities_model_file ON process_activities(model_file_id);
CREATE INDEX idx_business_points_model_file ON business_points(model_file_id);
CREATE INDEX idx_applications_model_file ON applications(model_file_id);
CREATE INDEX idx_application_components_model_file ON application_components(model_file_id);
CREATE INDEX idx_services_model_file ON services(model_file_id);
CREATE INDEX idx_interfaces_model_file ON interfaces(model_file_id);
CREATE INDEX idx_endpoints_model_file ON endpoints(model_file_id);
CREATE INDEX idx_application_points_model_file ON application_points(model_file_id);
CREATE INDEX idx_logical_data_entities_model_file ON logical_data_entities(model_file_id);
CREATE INDEX idx_logical_data_attributes_model_file ON logical_data_attributes(model_file_id);
CREATE INDEX idx_physical_data_entities_model_file ON physical_data_entities(model_file_id);
CREATE INDEX idx_physical_data_attributes_model_file ON physical_data_attributes(model_file_id);
CREATE INDEX idx_app_business_points_model_file ON app_business_points(model_file_id);
CREATE INDEX idx_interactions_model_file ON interactions(model_file_id);
CREATE INDEX idx_diagrams_model_file ON diagrams(model_file_id);
CREATE INDEX idx_diagram_nodes_diagram ON diagram_nodes(diagram_id);
CREATE INDEX idx_diagram_edges_diagram ON diagram_edges(diagram_id);
CREATE INDEX idx_diagram_interaction_edges_diagram ON diagram_interaction_edges(diagram_id);
CREATE INDEX idx_diagram_decorations_diagram ON diagram_decorations(diagram_id);
