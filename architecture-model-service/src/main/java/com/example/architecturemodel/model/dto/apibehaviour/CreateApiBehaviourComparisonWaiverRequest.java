package com.example.architecturemodel.model.dto.apibehaviour;

/**
 * Create body for a project-scoped comparison waiver (Spec 2026-07-06-j).
 * Global rows are seed-only (changeset 206) — the API always creates
 * {@code scope='project'} rows for the path project.
 */
public record CreateApiBehaviourComparisonWaiverRequest(
    String dimension,
    String target,
    String reason,
    String author,
    String provenance
) {}
