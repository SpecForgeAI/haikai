package com.example.architecturemodel.model.dto;

import java.util.List;

/**
 * Response DTO for {@code GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory}.
 *
 * <p>Drives the {@code SelectiveCopyElementPicker} tree on the frontend. The
 * shape is exactly:</p>
 *
 * <pre>
 * {
 *   domains: [
 *     {
 *       name: "Applications",
 *       types: [
 *         {
 *           name: "Applications",
 *           entityType: "applications",
 *           instances: [
 *             {id: "uuid", name: "Order Service", archived: null}
 *           ]
 *         },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 * </pre>
 *
 * <p>Domains are returned in the canonical order the picker renders:
 * {@code [Applications, Data, Business, UI, Behavioural, Diagrams]}.</p>
 *
 * <p>Empty inventories still return all six domain shells (no nulls / no
 * missing keys); types within a domain may have an empty {@code instances}
 * list; types with no rows in the source are omitted from the response.</p>
 *
 * <p>Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)</p>
 */
public record ElementInventoryResponse(List<Domain> domains) {

    /**
     * A top-level grouping in the picker tree (Applications, Data, Business,
     * UI, Behavioural, or Diagrams).
     */
    public record Domain(String name, List<Type> types) {}

    /**
     * One entity type within a domain (e.g. {@code applications},
     * {@code services}). The {@code entityType} is the underlying database
     * table name and is used by the selective-copy preflight to route
     * conflict-detection lookups to the right table.
     */
    public record Type(String name, String entityType, List<Instance> instances) {}

    /**
     * One instance of an entity type (e.g. one {@code Order Service}
     * application).
     *
     * @param id        the entity's UUID (TEXT primary key in the database,
     *                  surfaced as a String for the JSON contract).
     * @param name      the entity's display name (or its id when the
     *                  underlying table has no {@code name} column —
     *                  joins / link tables fall into this category).
     * @param archived  reserved for future per-element archival; null in V1
     *                  since architectures are the only currently-archivable
     *                  scope. Included in the contract per spec for
     *                  forward-compatibility.
     */
    public record Instance(String id, String name, Boolean archived) {}
}
