package com.example.architecturemodel.model.dto.security;

import java.util.List;

/**
 * Batch alias upsert from the wizard's value matcher (Security health
 * dashboard, 2026-07-19, Spec 1 of 3): every user-confirmed pairing is taught
 * in one call. Re-teaching an existing {@code (level, alias_value)} updates
 * the row. Snake_case wire (AMS global default).
 */
public record UpsertSecurityAliasesRequest(
    String level,
    List<AliasPair> aliases
) {

    /** One taught pairing: file value -&gt; model entity. */
    public record AliasPair(
        String aliasValue,
        String entityId,
        String entityName
    ) {
    }
}
