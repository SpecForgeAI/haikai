package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Confidence vocabulary for {@link MigrationStorySpecGenerationEntity}.
 *
 * <p>The LLM self-rates confidence in its response; the gateway then
 * validates that self-rating against deterministic signals (presence /
 * absence of mappings, baselines, contracts, evidence in the payload) and
 * may DOWNGRADE the value when LLM-rated {@code high} is contradicted by
 * empty / missing inputs (R-7). Confidence is never upgraded by the gateway.</p>
 *
 * <p>The DB CHECK constraint {@code chk_msg_confidence} (Liquibase changeset
 * 140) is the source of truth.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1.</p>
 */
public final class MigrationStorySpecGenerationConfidence {

    public static final String HIGH = "high";
    public static final String MEDIUM = "medium";
    public static final String LOW = "low";

    /**
     * The set of all allowed confidence values. Mirrors the DB CHECK
     * constraint {@code chk_msg_confidence} on changeset 140. Useful for
     * service-layer pre-validation. The column itself is nullable (e.g. for
     * {@code status=failed} rows where no confidence is meaningful).
     */
    public static final Set<String> ALL = Set.of(HIGH, MEDIUM, LOW);

    private MigrationStorySpecGenerationConfidence() {
        // utility / constants holder
    }
}
