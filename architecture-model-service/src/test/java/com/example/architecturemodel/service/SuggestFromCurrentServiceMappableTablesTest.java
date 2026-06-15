package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Maintenance-hook regression test that locks in the subset invariant between
 * {@link SuggestFromCurrentService#MAPPABLE_ELEMENT_TABLES} and
 * {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER}.
 *
 * <p>{@code MAPPABLE_ELEMENT_TABLES} is curated -- per the Javadoc on
 * {@code SuggestFromCurrentService} -- by keeping every base-entity table
 * from the clone service's {@code IN_SCOPE_TABLES_IN_ORDER} that carries a
 * user-visible {@code name} column. If a future contributor removes a base
 * table from {@code IN_SCOPE_TABLES_IN_ORDER} (or renames it) without
 * updating {@code MAPPABLE_ELEMENT_TABLES}, the deterministic
 * suggest-from-current path silently skips that table at mapping time.</p>
 *
 * <p>This test asserts the lightweight "subset" half of the invariant only:
 * every table named in {@code MAPPABLE_ELEMENT_TABLES} MUST exist in
 * {@code IN_SCOPE_TABLES_IN_ORDER}. The harder converse direction ("every
 * name-column table in IN_SCOPE_TABLES_IN_ORDER must be in
 * MAPPABLE_ELEMENT_TABLES") would require runtime database introspection and
 * is deferred per v1 scope.</p>
 *
 * <p>Both lists are package-private {@code static final} constants and the
 * test lives in the same package so it reads them via direct field
 * access -- mirroring {@link ArchitectureCloneServiceInScopeTablesTest}.</p>
 */
class SuggestFromCurrentServiceMappableTablesTest {

    private static final List<String> MAPPABLE = SuggestFromCurrentService.MAPPABLE_ELEMENT_TABLES;
    private static final List<String> IN_SCOPE = ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER;

    @Test
    @DisplayName("Every entry in MAPPABLE_ELEMENT_TABLES exists in ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER (subset invariant)")
    void mappableElementTablesAreSubsetOfInScopeTables() {
        assertThat(MAPPABLE)
            .as("MAPPABLE_ELEMENT_TABLES sanity: must be non-empty")
            .isNotEmpty();
        assertThat(IN_SCOPE)
            .as("IN_SCOPE_TABLES_IN_ORDER sanity: must be non-empty")
            .isNotEmpty();

        Set<String> inScopeSet = new HashSet<>(IN_SCOPE);
        List<String> missing = new ArrayList<>();
        for (String table : MAPPABLE) {
            if (!inScopeSet.contains(table)) {
                missing.add(table);
            }
        }

        assertThat(missing)
            .as(
                "SuggestFromCurrentService.MAPPABLE_ELEMENT_TABLES contains entries " +
                "that are NOT in ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER. " +
                "Either those tables were renamed/removed from the clone service " +
                "(in which case remove them from MAPPABLE_ELEMENT_TABLES too) or " +
                "MAPPABLE_ELEMENT_TABLES has a typo. Missing tables: %s",
                missing
            )
            .isEmpty();
    }
}
