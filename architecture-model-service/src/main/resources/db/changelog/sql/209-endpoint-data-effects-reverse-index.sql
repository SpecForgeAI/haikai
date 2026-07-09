-- ============================================================================
-- 209: endpoint_data_effects reverse-query index (Spec 2026-07-06-f — T-SQL
-- Affinity & Consumer Revalidation, Code-Tier Oracle Program).
--
-- "Which endpoints touch table X / proc Y" is the affected-consumer
-- computation's core read (dbChangeConsumerResolver): a reverse lookup by
-- data_entity_point_id. The column had endpoint-side + model-file indexes
-- only; this adds the data-entity side so the reverse query is indexed.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_endpoint_data_effects_data_entity_point
    ON endpoint_data_effects (data_entity_point_id);
