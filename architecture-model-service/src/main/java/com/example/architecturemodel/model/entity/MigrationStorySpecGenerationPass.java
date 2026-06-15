package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Generation-pass vocabulary for {@link MigrationStorySpecGenerationEntity}.
 *
 * <p>Held as {@code public static final Integer} constants (not a Java
 * {@code enum}) to match the established AMS pattern used by
 * {@link MigrationStorySpecGenerationStatus}.</p>
 *
 * <p>The DB CHECK constraint {@code chk_msg_generation_pass} (Liquibase
 * changeset 141) is the source of truth: allowed values are {@code 1} and
 * {@code 2}. Renaming, adding, or removing values requires a NEW changeset
 * per {@code feedback_liquibase_immutable_changesets.md}.</p>
 *
 * <p>Hard cap at 2 is also enforced at the gateway handler boundary
 * (Cross-Story Context Injection spec, Task Group 5). There is no pass 3;
 * the handler refuses any third-pass request from the gateway boundary
 * regardless of caller intent.</p>
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 1.</p>
 */
public final class MigrationStorySpecGenerationPass {

    /** Pass 1: parent_rollup + workstream_context only; no sibling summaries. */
    public static final Integer PASS_1 = 1;

    /** Pass 2: sibling-aware regeneration after pass 1 fully completes. */
    public static final Integer PASS_2 = 2;

    /**
     * The set of all allowed persisted generation-pass values. Mirrors the DB
     * CHECK constraint {@code chk_msg_generation_pass} on changeset 141.
     * Useful for service-layer pre-validation before issuing the JDBC write.
     */
    public static final Set<Integer> ALL = Set.of(PASS_1, PASS_2);

    /**
     * Returns {@code true} if the supplied pass value is one of the persisted
     * values. {@code null} returns {@code false}.
     */
    public static boolean isValid(Integer pass) {
        return pass != null && ALL.contains(pass);
    }

    private MigrationStorySpecGenerationPass() {
        // utility / constants holder
    }
}
