package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.model.dto.ElementInventoryResponse;
import com.example.architecturemodel.model.dto.ElementInventoryResponse.Domain;
import com.example.architecturemodel.model.dto.ElementInventoryResponse.Instance;
import com.example.architecturemodel.model.dto.ElementInventoryResponse.Type;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Read-only service that builds the picker-tree inventory for a single
 * architecture by sweeping every in-scope architecture-scoped table.
 *
 * <p>Powers {@code GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory}.
 * The response shape mirrors {@link ElementInventoryResponse}:</p>
 *
 * <pre>
 * {domains: [{name, types: [{name, entityType, instances: [{id, name, archived}]}]}]}
 * </pre>
 *
 * <h2>Domain assignments</h2>
 *
 * <p>The six canonical domains (in render order) and their constituent
 * tables are:</p>
 *
 * <ul>
 *   <li><b>Applications</b> — {@code applications}, {@code application_components},
 *       {@code services}, {@code interfaces}, {@code endpoints},
 *       {@code application_points}, {@code classes}, {@code methods},
 *       {@code package_sets}, {@code packages},
 *       {@code package_set_default_rules},
 *       {@code package_set_standards_import_status}.</li>
 *   <li><b>Data</b> — {@code logical_data_entities}, {@code logical_data_attributes},
 *       {@code physical_data_entities}, {@code physical_data_attributes},
 *       {@code data_entity_points}, {@code logical_data_entity_relationships},
 *       {@code logical_data_entity_physical_data_entities},
 *       {@code logical_data_attribute_physical_data_attributes},
 *       {@code data_movements}, {@code interface_logical_entities}.</li>
 *   <li><b>Business</b> — {@code business_users}, {@code business_processes},
 *       {@code process_activities}, {@code business_points},
 *       {@code business_logics}, {@code app_business_points},
 *       {@code interactions}, {@code user_journeys}, {@code activity_steps},
 *       {@code business_user_business_points},
 *       {@code application_point_business_points},
 *       {@code application_point_business_logics},
 *       {@code user_journey_links}.</li>
 *   <li><b>UI</b> — {@code ui_screens}, {@code ui_components},
 *       {@code ui_actions}, {@code ui_contracts}, {@code ui_characteristics},
 *       {@code ui_workflow_transitions}.</li>
 *   <li><b>Behavioural</b> — {@code events}, {@code states},
 *       {@code state_transitions}, {@code activities},
 *       {@code activity_partitions}, {@code activity_flows},
 *       {@code sequence_diagrams}, {@code sequence_participants},
 *       {@code sequence_messages}, {@code sequence_fragments},
 *       {@code sequence_operands}, {@code sequence_nodes}.</li>
 *   <li><b>Diagrams</b> — {@code diagrams}, {@code diagram_nodes},
 *       {@code diagram_edges}, {@code diagram_decorations},
 *       {@code diagram_interaction_edges}, {@code temporary_diagrams}.</li>
 * </ul>
 *
 * <p>The complete set of tables matches the in-scope list documented in
 * {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER} verbatim — the
 * inventory is the "user-visible" view of the same scope the clone /
 * selective-copy services act on.</p>
 *
 * <h2>Excluded scopes (safety property (g))</h2>
 *
 * <p>Inventory NEVER touches:</p>
 * <ul>
 *   <li><b>Threads</b> — file-based, project-scoped; not in DB.</li>
 *   <li><b>{@code discovery_*} tables</b> — Discovery's locked
 *       "one run -> one architecture" rule + immutable provenance.</li>
 *   <li><b>Project-scoped tables</b> — {@code project},
 *       {@code delivery_teams}, {@code organisations}, {@code work_item*},
 *       {@code project_artifact}, {@code product_definitions}.</li>
 * </ul>
 *
 * <h2>Architecture-scope read path (Spec 2026-05-22)</h2>
 *
 * <p>Every per-table scan derives the row's architecture-scope from the
 * row's <b>parent</b> (joining {@code model_files} via
 * {@code model_file_id}, {@code sequence_diagrams} via
 * {@code sequence_diagram_id}, or {@code sequence_fragments} via
 * {@code fragment_id} — the three chains documented in changeset
 * {@code 097-architecture-id-auto-derive-trigger.sql}). The leaf
 * {@code architecture_id} column on each entity table is NO LONGER
 * read — it stays in place as a write-time optimisation but can drift
 * from the parent (there's no UPDATE trigger keeping the two in sync) so
 * the read path agrees with the canonical
 * {@link ModelService#loadModelByFileId} pattern by going through
 * {@link ArchitectureScopeResolver}.</p>
 *
 * <p>Tables outside the resolver's three chains (today only
 * {@code temporary_diagrams}, whose architecture_id is direct) fall
 * back to the legacy leaf-column query, emitting a WARN log line so
 * future additions are surfaced. None of the in-scope element tables
 * fall into this case — the fallback is defensive guard for future
 * additions.</p>
 *
 * <h2>Display-name resolution</h2>
 *
 * <p>For each table, the service queries {@code id} plus the natural
 * display field (a {@code name} column where present, otherwise the id
 * is repeated as the display label so join / link rows still render in
 * the picker tree). See {@link #DISPLAY_NAME_FALLBACK_TABLES} for the
 * tables without a {@code name} column.</p>
 *
 * <h2>Empty-architecture behaviour</h2>
 *
 * <p>An architecture with zero rows still returns the six domain shells
 * (no nulls / no missing keys); types with no rows are simply omitted
 * from their domain's {@code types} list, leaving an empty list under
 * the domain.</p>
 *
 * <h2>UUID column type-binding (PostgreSQL strict-mode hotfix)</h2>
 *
 * <p>The {@code architecture_id} column on the parent table
 * ({@code model_files} / {@code sequence_diagrams} /
 * {@code sequence_fragments}) is a native PostgreSQL {@code uuid}
 * (Liquibase 089). PostgreSQL refuses {@code uuid = varchar}
 * comparisons strictly; H2 in PG mode silently coerces. The inventory
 * probe binds the filter as a {@link UUID} object (not a string) so the
 * query succeeds on production PG.</p>
 *
 * <p>Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7);
 * read-path fix per spec 2026-05-22-architecture-scope-via-parent-not-leaf.</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ArchitectureElementInventoryService {

    /**
     * Canonical render-order of the six domains. The wizard's picker tree
     * renders the response's {@code domains} list in this exact order, so
     * the service emits the list in this order.
     */
    static final List<String> DOMAIN_ORDER = List.of(
        "Applications",
        "Data",
        "Business",
        "UI",
        "Behavioural",
        "Infrastructure",
        "Diagrams"
    );

    /**
     * Per-table presentation metadata for the picker tree. The order within
     * each domain is preserved in the response so related types render
     * adjacent (e.g. {@code applications} -> {@code application_components}
     * -> {@code services} within Applications).
     *
     * <p>Each entry maps the database table name to the human-readable
     * {@code Type.name} the picker displays.</p>
     */
    static final Map<String, List<Map.Entry<String, String>>> TABLES_BY_DOMAIN = buildTablesByDomain();

    /**
     * Tables whose schema does not include a {@code name} column. For these
     * the service falls back to displaying the id as the label so the row
     * still appears in the picker tree (the user can still tick join rows
     * even though their natural-key labels are unfriendly).
     */
    static final Set<String> DISPLAY_NAME_FALLBACK_TABLES = Set.of(
        // Business join / link tables
        "business_user_business_points",
        "application_point_business_points",
        "application_point_business_logics",
        "user_journey_links",
        // Data join / relationship tables
        "logical_data_entity_relationships",
        "logical_data_entity_physical_data_entities",
        "logical_data_attribute_physical_data_attributes",
        "interface_logical_entities",
        // Behavioural join tables
        "state_transitions",
        "activity_flows",
        // UI flow / transition tables
        "ui_workflow_transitions",
        // Diagram dependent rows (some have label_text but no name column)
        "diagram_nodes",
        "diagram_edges",
        "diagram_decorations",
        "diagram_interaction_edges",
        // Application low-level metadata without a name column
        "package_set_default_rules",
        "package_set_standards_import_status",
        // Infrastructure polymorphic supertype (discriminator + 12 typed FKs,
        // no name column) and relationship tables (tags but no name column)
        "infrastructure_points",
        "resource_subnet_hostings",
        "deployment_unit_compute_resources",
        "load_balancer_resource_routes",
        // Infrastructure cross-domain relationships (Spec:
        // 2026-05-05-infrastructure-cross-domain-integration). None has a
        // name column.
        "application_compute_deployments",
        "data_entity_data_store_hostings",
        "application_infrastructure_resource_uses",
        "application_load_balancer_exposures",
        // Infrastructure Terraform & Discovery Readiness (Spec:
        // 2026-05-05-infrastructure-terraform-discovery-readiness).
        // iac_resource_bindings is a relationship envelope without a name
        // column. iac_sources HAS a name column and is intentionally NOT
        // added to this fallback set.
        "iac_resource_bindings",
        // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation):
        // code_unit_dependencies is a relationship envelope without a name
        // column. libraries HAS a name column and is intentionally NOT added.
        "code_unit_dependencies"
    );

    private final ArchitectureRepository architectureRepository;
    private final JdbcTemplate jdbcTemplate;

    public ArchitectureElementInventoryService(ArchitectureRepository architectureRepository,
                                               JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Builds the inventory tree for the supplied architecture.
     *
     * <p>Always returns the six canonical domains (in render order) even
     * for an empty architecture; types with no rows are omitted.</p>
     *
     * @param projectId       project the architecture must belong to (404
     *                        if mismatch).
     * @param architectureId  architecture to introspect (404 if missing or
     *                        cross-project).
     * @return the inventory response.
     * @throws ArchitectureNotFoundException
     *     if the architecture is missing or belongs to a different project
     *     (mapped to 404 by {@code GlobalExceptionHandler}).
     */
    @Transactional(readOnly = true)
    public ElementInventoryResponse getInventory(UUID projectId, UUID architectureId) {
        log.debug("Building element inventory for architecture {} in project {}",
            architectureId, projectId);

        // Validate architecture exists in project (404 path).
        ArchitectureEntity arch = architectureRepository.findById(architectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + architectureId));
        if (!projectId.equals(arch.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + architectureId + " not found in project " + projectId);
        }

        List<Domain> domains = new ArrayList<>(DOMAIN_ORDER.size());

        for (String domainName : DOMAIN_ORDER) {
            List<Map.Entry<String, String>> tablesInDomain =
                TABLES_BY_DOMAIN.getOrDefault(domainName, List.of());
            List<Type> types = new ArrayList<>();
            for (Map.Entry<String, String> tableEntry : tablesInDomain) {
                String tableName = tableEntry.getKey();
                String displayName = tableEntry.getValue();
                List<Instance> instances = readInstances(tableName, architectureId);
                if (!instances.isEmpty()) {
                    types.add(new Type(displayName, tableName, instances));
                }
            }
            domains.add(new Domain(domainName, types));
        }

        log.debug("Inventory for architecture {}: {} domains, {} populated types",
            architectureId, domains.size(),
            domains.stream().mapToInt(d -> d.types().size()).sum());

        return new ElementInventoryResponse(domains);
    }

    /**
     * Reads {@code id} + display-name rows from a single in-scope table,
     * filtered by the row's parent architecture-scope via
     * {@link ArchitectureScopeResolver}.
     *
     * <p>The primary read path JOINs the element table to its canonical
     * parent ({@code model_files} / {@code sequence_diagrams} /
     * {@code sequence_fragments}) and predicates on the parent's
     * {@code architecture_id}. This is invariant to drift in the leaf
     * {@code architecture_id} column on the element table itself —
     * matching how {@link ModelService#loadModelByFileId} treats the
     * model.</p>
     *
     * <p>For tables outside the resolver's three chains (today only
     * {@code temporary_diagrams}, which is project-scoped with a direct
     * {@code architecture_id}), the service falls back to the legacy
     * leaf-column query and emits a WARN log line — a defensive guard
     * so future additions of in-scope tables are surfaced.</p>
     *
     * <p>UUID binding: {@code architectureId} is passed as {@link UUID}
     * (not String) so PostgreSQL's strict {@code uuid = ?} match
     * succeeds; H2 in PG mode silently coerces.</p>
     *
     * <p>If the table does not exist in the underlying schema (e.g. an
     * H2 fixture missing some tables in a unit test), an empty list is
     * returned so the inventory degrades gracefully — the production
     * schema always has every in-scope table.</p>
     */
    private List<Instance> readInstances(String table, UUID architectureId) {
        boolean hasNameColumn = !DISPLAY_NAME_FALLBACK_TABLES.contains(table)
            && tableHasNameColumn(table);

        // Columns are projected from the element table only; the join's
        // sole purpose is to evaluate the architecture-scope predicate
        // against the parent. Aliasing as t.* avoids ambiguity with the
        // parent's id column.
        String selectColumns = hasNameColumn ? "t.id, t.name" : "t.id";

        String sql;
        if (ArchitectureScopeResolver.hasParent(table)) {
            // Primary path: route via the canonical parent chain.
            sql = ArchitectureScopeResolver.buildScopedSelectClause(table, selectColumns);
        } else {
            // Defensive fallback: for tables outside the parent map (today
            // only temporary_diagrams) read the leaf column directly. This
            // branch is intentionally narrow — a WARN log fires so future
            // in-scope additions get caught.
            log.warn(
                "Inventory table '{}' has no architecture-scope parent registered; "
                    + "falling back to leaf architecture_id column. "
                    + "Add an ArchitectureScopeResolver entry if this is an in-scope element table.",
                table);
            String fallbackColumns = hasNameColumn ? "id, name" : "id";
            sql = "SELECT " + fallbackColumns + " FROM " + table
                + " WHERE architecture_id = ?";
        }

        try {
            // architecture_id is a native UUID column on PG; bind as UUID.
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, architectureId);
            List<Instance> instances = new ArrayList<>(rows.size());
            for (Map<String, Object> row : rows) {
                Object idObj = row.get("id");
                if (idObj == null) continue;
                String id = idObj.toString();
                String label;
                if (hasNameColumn) {
                    Object nameObj = row.get("name");
                    label = nameObj == null ? id : nameObj.toString();
                } else {
                    label = id;
                }
                instances.add(new Instance(id, label, null));
            }
            return instances;
        } catch (BadSqlGrammarException ex) {
            // Table or required column missing in the active schema (e.g.
            // a partial H2 fixture in a unit test, or the element table
            // is missing its parent FK column). Skip cleanly.
            log.debug("Inventory skipped table '{}' (bad grammar): {}", table, ex.getMessage());
            return List.of();
        } catch (DataAccessException ex) {
            log.warn("Inventory skipped table '{}' due to data access error: {}",
                table, ex.getMessage());
            return List.of();
        }
    }

    /**
     * Detects whether the given table has a {@code name} column via JDBC
     * {@link DatabaseMetaData}. Returns {@code false} when the table is
     * missing or has no columns discoverable (so the caller falls back to
     * id-only display).
     */
    private boolean tableHasNameColumn(String table) {
        DataSource ds = jdbcTemplate.getDataSource();
        if (ds == null) {
            return false;
        }
        try (Connection conn = ds.getConnection()) {
            DatabaseMetaData md = conn.getMetaData();
            if (columnsContainName(md, table)) {
                return true;
            }
            // H2 default: unquoted identifiers are upper-case.
            return columnsContainName(md, table.toUpperCase(Locale.ROOT));
        } catch (SQLException e) {
            log.debug("Failed to probe columns for table '{}': {}", table, e.getMessage());
            return false;
        }
    }

    private boolean columnsContainName(DatabaseMetaData md, String table) throws SQLException {
        try (ResultSet rs = md.getColumns(null, null, table, null)) {
            while (rs.next()) {
                String columnName = rs.getString("COLUMN_NAME");
                if (columnName != null && "name".equalsIgnoreCase(columnName)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Static initialiser for the per-domain table list.
     *
     * <p>Order within each domain is preserved in the response — related
     * types appear adjacent (e.g. {@code applications} before
     * {@code services}). The full list mirrors
     * {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER} verbatim,
     * partitioned by domain.</p>
     */
    private static Map<String, List<Map.Entry<String, String>>> buildTablesByDomain() {
        Map<String, List<Map.Entry<String, String>>> map = new LinkedHashMap<>();

        // APPLICATIONS — application stack from top-level applications down
        // through services / interfaces / endpoints / classes / packages.
        map.put("Applications", List.of(
            entry("applications", "Applications"),
            entry("application_components", "Application Components"),
            entry("services", "Services"),
            entry("interfaces", "Interfaces"),
            entry("endpoints", "Endpoints"),
            entry("application_points", "Application Points"),
            entry("classes", "Classes"),
            entry("methods", "Methods"),
            entry("package_sets", "Package Sets"),
            entry("packages", "Packages"),
            entry("package_set_default_rules", "Package Set Default Rules"),
            entry("package_set_standards_import_status", "Package Set Standards Import Status"),
            // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
            entry("libraries", "Libraries"),
            entry("code_unit_dependencies", "Code Unit Dependencies")
        ));

        // DATA — logical + physical entities, attributes, relationships,
        // movements, interface bindings.
        map.put("Data", List.of(
            entry("logical_data_entities", "Logical Data Entities"),
            entry("logical_data_attributes", "Logical Data Attributes"),
            entry("physical_data_entities", "Physical Data Entities"),
            entry("physical_data_attributes", "Physical Data Attributes"),
            entry("data_entity_points", "Data Entity Points"),
            entry("logical_data_entity_relationships", "Logical Data Entity Relationships"),
            entry("logical_data_entity_physical_data_entities", "Logical-Physical Entity Mappings"),
            entry("logical_data_attribute_physical_data_attributes", "Logical-Physical Attribute Mappings"),
            entry("data_movements", "Data Movements"),
            entry("interface_logical_entities", "Interface-Entity Bindings")
        ));

        // BUSINESS — business processes, users, points, logic, activities,
        // user journeys, interactions.
        map.put("Business", List.of(
            entry("business_users", "Business Users"),
            entry("business_processes", "Business Processes"),
            entry("process_activities", "Process Activities"),
            entry("business_points", "Business Points"),
            entry("business_logics", "Business Logic"),
            entry("app_business_points", "App-Business Points"),
            entry("interactions", "Interactions"),
            entry("user_journeys", "User Journeys"),
            entry("activity_steps", "Activity Steps"),
            entry("business_user_business_points", "Business User to Business Point Links"),
            entry("application_point_business_points", "App Point to Business Point Links"),
            entry("application_point_business_logics", "App Point to Business Logic Links"),
            entry("user_journey_links", "User Journey Links")
        ));

        // UI — screens, components, actions, contracts, characteristics,
        // workflow transitions.
        map.put("UI", List.of(
            entry("ui_screens", "UI Screens"),
            entry("ui_components", "UI Components"),
            entry("ui_actions", "UI Actions"),
            entry("ui_contracts", "UI Contracts"),
            entry("ui_characteristics", "UI Characteristics"),
            entry("ui_workflow_transitions", "UI Workflow Transitions")
        ));

        // BEHAVIOURAL — events, states, activities, sequences.
        map.put("Behavioural", List.of(
            entry("events", "Events"),
            entry("states", "States"),
            entry("state_transitions", "State Transitions"),
            entry("activities", "Activities"),
            entry("activity_partitions", "Activity Partitions"),
            entry("activity_flows", "Activity Flows"),
            entry("sequence_diagrams", "Sequence Diagrams"),
            entry("sequence_participants", "Sequence Participants"),
            entry("sequence_messages", "Sequence Messages"),
            entry("sequence_fragments", "Sequence Fragments"),
            entry("sequence_operands", "Sequence Operands"),
            entry("sequence_nodes", "Sequence Nodes")
        ));

        // INFRASTRUCTURE — environments, cloud accounts, locations,
        // networks, subnets, compute clusters/resources, deployment units,
        // load balancers, listeners, data store instances, infrastructure
        // resources, polymorphic infrastructure points, plus relationship
        // tables. Mirrors IN_SCOPE_TABLES_IN_ORDER for the Infrastructure
        // domain (12 entity tables -> infrastructure_points -> 3
        // relationship tables).
        map.put("Infrastructure", List.of(
            entry("environments", "Environments"),
            entry("cloud_accounts", "Cloud Accounts"),
            entry("locations", "Locations"),
            entry("networks", "Networks"),
            entry("subnets", "Subnets"),
            entry("compute_clusters", "Compute Clusters"),
            entry("compute_resources", "Compute Resources"),
            entry("deployment_units", "Deployment Units"),
            entry("load_balancers", "Load Balancers"),
            entry("listeners", "Listeners"),
            entry("data_store_instances", "Data Store Instances"),
            entry("infrastructure_resources", "Infrastructure Resources"),
            entry("infrastructure_points", "Infrastructure Points"),
            entry("resource_subnet_hostings", "Resource-Subnet Hostings"),
            entry("deployment_unit_compute_resources", "Deployment Unit-Compute Mappings"),
            entry("load_balancer_resource_routes", "Load Balancer Routes"),
            // Infrastructure cross-domain relationships (Spec:
            // 2026-05-05-infrastructure-cross-domain-integration). Cross-domain
            // relationships sit once under Infrastructure here; per-domain tab
            // visibility is derivation-based via getRelationshipsForDomain.
            entry("application_compute_deployments", "App-Compute Deployments"),
            entry("data_entity_data_store_hostings", "Data Entity-Data Store Hostings"),
            entry("application_infrastructure_resource_uses", "App-Infrastructure Resource Uses"),
            entry("application_load_balancer_exposures", "App-Load Balancer Exposures"),
            // Infrastructure Terraform & Discovery Readiness (Spec:
            // 2026-05-05-infrastructure-terraform-discovery-readiness).
            // iac_sources is a true entity (has name); iac_resource_bindings is
            // a relationship envelope (no name column -- handled via
            // DISPLAY_NAME_FALLBACK_TABLES).
            entry("iac_sources", "IaC Sources"),
            entry("iac_resource_bindings", "IaC Resource Bindings")
        ));

        // DIAGRAMS — diagram canvas tables + project-scoped temporary
        // diagrams (which carry an architecture_id per spec #1's
        // architecture_id rollout).
        map.put("Diagrams", List.of(
            entry("diagrams", "Diagrams"),
            entry("diagram_nodes", "Diagram Nodes"),
            entry("diagram_edges", "Diagram Edges"),
            entry("diagram_decorations", "Diagram Decorations"),
            entry("diagram_interaction_edges", "Diagram Interaction Edges"),
            entry("temporary_diagrams", "Temporary Diagrams")
        ));

        return map;
    }

    private static Map.Entry<String, String> entry(String tableName, String displayName) {
        return Map.entry(tableName, displayName);
    }
}
