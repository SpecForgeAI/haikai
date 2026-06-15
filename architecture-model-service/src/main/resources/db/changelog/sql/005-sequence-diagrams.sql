-- ============================================================================
-- Task Group 1: Sequence Diagram Tables for Behavioural Architecture Domain
-- UML-style Sequence Diagram persistence with participants, messages,
-- control fragments, operands, and ordering nodes
-- ============================================================================

-- ============================================================================
-- SEQUENCE_DIAGRAMS TABLE (Root Entity)
-- ============================================================================

CREATE TABLE sequence_diagrams (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  type               TEXT DEFAULT 'Sequence',
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sequence_diagrams_model_file ON sequence_diagrams(model_file_id);

-- ============================================================================
-- SEQUENCE_PARTICIPANTS TABLE
-- Represents participants (lifelines) in the sequence diagram
-- ref_kind values: BusinessUser, Application, ApplicationComponent, Service,
--                  Interface, InterfaceEndpoint, Class
-- ============================================================================

CREATE TABLE sequence_participants (
  id                   TEXT PRIMARY KEY,
  sequence_diagram_id  TEXT NOT NULL REFERENCES sequence_diagrams(id) ON DELETE CASCADE,
  ref_kind             VARCHAR(50) NOT NULL,
  ref_id               VARCHAR(255) NOT NULL,
  order_index          INTEGER NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sequence_participants_diagram ON sequence_participants(sequence_diagram_id);

-- ============================================================================
-- SEQUENCE_MESSAGES TABLE
-- Represents messages exchanged between participants
-- exchange_role values: Request, Response
-- ref_kind values (when present): Method, LogicalEntity, PhysicalEntity, Class, Event
-- One-of constraint: either (ref_kind + ref_id) OR label_text must be present
-- ============================================================================

CREATE TABLE sequence_messages (
  id                   TEXT PRIMARY KEY,
  sequence_diagram_id  TEXT NOT NULL REFERENCES sequence_diagrams(id) ON DELETE CASCADE,
  exchange_id          VARCHAR(255) NOT NULL,
  exchange_role        VARCHAR(20) NOT NULL,
  from_participant_id  TEXT NOT NULL REFERENCES sequence_participants(id),
  to_participant_id    TEXT NOT NULL REFERENCES sequence_participants(id),
  ref_kind             VARCHAR(50),
  ref_id               VARCHAR(255),
  label_text           TEXT,
  created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sequence_messages_exchange ON sequence_messages(sequence_diagram_id, exchange_id);

-- ============================================================================
-- SEQUENCE_FRAGMENTS TABLE
-- Represents control flow fragments (combined fragments in UML)
-- fragment_kind values: Loop, Optional, Alternative
-- ============================================================================

CREATE TABLE sequence_fragments (
  id                   TEXT PRIMARY KEY,
  sequence_diagram_id  TEXT NOT NULL REFERENCES sequence_diagrams(id) ON DELETE CASCADE,
  fragment_kind        VARCHAR(20) NOT NULL,
  label_text           TEXT,
  created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sequence_fragments_diagram ON sequence_fragments(sequence_diagram_id);

-- ============================================================================
-- SEQUENCE_OPERANDS TABLE
-- Represents operands within a fragment (e.g., if/else branches in alt)
-- guard_expression: condition for this operand branch
-- ============================================================================

CREATE TABLE sequence_operands (
  id                 TEXT PRIMARY KEY,
  fragment_id        TEXT NOT NULL REFERENCES sequence_fragments(id) ON DELETE CASCADE,
  guard_expression   TEXT NOT NULL,
  operand_index      INTEGER NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_sequence_operands_fragment_index UNIQUE (fragment_id, operand_index)
);

CREATE INDEX idx_sequence_operands_fragment ON sequence_operands(fragment_id);

-- ============================================================================
-- SEQUENCE_NODES TABLE (Diagram-Only Ordering)
-- Defines the ordering of messages and fragments within the sequence diagram
-- node_kind values: Message, Fragment
-- When node_kind=Message: message_id required, fragment_id must be null
-- When node_kind=Fragment: fragment_id required, message_id must be null
-- parent_node_id: for nesting nodes inside fragments
-- parent_operand_id: for placing nodes inside specific operands
-- ============================================================================

CREATE TABLE sequence_nodes (
  id                   TEXT PRIMARY KEY,
  sequence_diagram_id  TEXT NOT NULL REFERENCES sequence_diagrams(id) ON DELETE CASCADE,
  node_kind            VARCHAR(20) NOT NULL,
  message_id           TEXT REFERENCES sequence_messages(id),
  fragment_id          TEXT REFERENCES sequence_fragments(id),
  order_index          INTEGER NOT NULL,
  parent_node_id       TEXT REFERENCES sequence_nodes(id),
  parent_operand_id    TEXT REFERENCES sequence_operands(id),
  created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sequence_nodes_hierarchy ON sequence_nodes(sequence_diagram_id, parent_node_id);
