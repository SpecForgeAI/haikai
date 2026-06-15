package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ArchivedArchitectureSourceException;
import com.example.architecturemodel.exception.DuplicateArchitectureNameException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Service that performs an atomic full clone of an architecture and every
 * architecture-scoped row beneath it.
 *
 * <p>The clone is wrapped in a single Spring {@link Transactional} boundary
 * (see {@link #cloneArchitecture(UUID, UUID, String, String, List)}). Any
 * exception thrown anywhere in the clone — validation, archived-source,
 * duplicate-name, repository / JDBC failure, or a forced exception during
 * testing — triggers a full rollback. This is safety property (a) of spec
 * #6.</p>
 *
 * <h2>Authoritative in-scope table list (compiled by sweeping changeset
 * 089-add-architecture-id-columns.sql; spec #1)</h2>
 *
 * <p>The clone duplicates every row whose {@code architecture_id} matches
 * the source architecture in the following tables, listed in dependency
 * order so each parent is cloned before its children:</p>
 *
 * <p><b>ROOT (project-aware, owns the architecture binding):</b>
 * <ul>
 *   <li>model_files</li>
 * </ul></p>
 *
 * <p><b>BASE ENTITIES (model_file_id-scoped — must be cloned before
 * dependent rows so the old-to-new id map is populated):</b></p>
 *
 * <p><i>Business domain (excluding {@code activity_steps}, which references
 * {@code applications} / {@code business_users} / {@code process_activities}
 * / {@code user_journeys} and is therefore cloned in the dependent-rows
 * section below — see Hotfix #3 ordering audit):</i></p>
 * <ul>
 *   <li>business_users</li>
 *   <li>business_processes</li>
 *   <li>process_activities</li>
 *   <li>business_points</li>
 *   <li>business_logics</li>
 *   <li>user_journeys</li>
 * </ul>
 *
 * <p><i>Application domain (Hotfix #3: package_sets / packages /
 * package_set_default_rules / package_set_standards_import_status precede
 * services because {@code services.package_set_id REFERENCES
 * package_sets(id)}; data_entity_points precedes endpoints because
 * {@code endpoints.request_data_entity_point_id} +
 * {@code endpoints.response_data_entity_point_id REFERENCES
 * data_entity_points(id)}; data_entity_points itself depends on
 * logical_data_entities + physical_data_entities so those move up too):</i></p>
 * <ul>
 *   <li>logical_data_entities</li>
 *   <li>logical_data_attributes</li>
 *   <li>physical_data_entities</li>
 *   <li>physical_data_attributes</li>
 *   <li>data_entity_points</li>
 *   <li>applications</li>
 *   <li>application_components</li>
 *   <li>package_sets</li>
 *   <li>packages</li>
 *   <li>package_set_default_rules</li>
 *   <li>package_set_standards_import_status</li>
 *   <li>services</li>
 *   <li>interfaces</li>
 *   <li>endpoints</li>
 *   <li>application_points</li>
 *   <li>classes</li>
 *   <li>methods</li>
 * </ul>
 *
 * <p><i>Interaction domain:</i></p>
 * <ul>
 *   <li>app_business_points</li>
 *   <li>interactions</li>
 * </ul>
 *
 * <p><i>Behavioural domain (events / states / activities / sequence):</i></p>
 * <ul>
 *   <li>events</li>
 *   <li>states</li>
 *   <li>activities</li>
 *   <li>activity_partitions</li>
 *   <li>sequence_diagrams</li>
 * </ul>
 *
 * <p><i>UI domain (Hotfix #3: ui_contracts precedes ui_actions because
 * {@code ui_actions.contract_id REFERENCES ui_contracts(id)}):</i></p>
 * <ul>
 *   <li>ui_screens</li>
 *   <li>ui_components</li>
 *   <li>ui_contracts</li>
 *   <li>ui_actions</li>
 *   <li>ui_characteristics</li>
 * </ul>
 *
 * <p><i>Diagram domain:</i></p>
 * <ul>
 *   <li>diagrams</li>
 *   <li>diagram_nodes</li>
 *   <li>diagram_decorations</li>
 * </ul>
 *
 * <p><b>DEPENDENT ROWS (reference base entities — cloned after all base
 * entities so every FK can be remapped via the in-memory old-to-new id
 * map):</b></p>
 *
 * <p><i>Business join tables / links / steps:</i></p>
 * <ul>
 *   <li>business_user_business_points</li>
 *   <li>application_point_business_points</li>
 *   <li>application_point_business_logics</li>
 *   <li>user_journey_links</li>
 *   <li>activity_steps (Hotfix #3: refs applications + process_activities +
 *       business_users + user_journeys; previously placed in the BUSINESS
 *       base-entity block which preceded APPLICATION, leaving its
 *       {@code application_id} column unrewired — the cloned activity_step
 *       silently pointed at the source architecture's application row in
 *       PostgreSQL because the source row still satisfied the FK)</li>
 * </ul>
 *
 * <p><i>Data join tables / relationships:</i></p>
 * <ul>
 *   <li>logical_data_entity_relationships</li>
 *   <li>logical_data_entity_physical_data_entities</li>
 *   <li>logical_data_attribute_physical_data_attributes</li>
 *   <li>data_movements</li>
 *   <li>interface_logical_entities</li>
 * </ul>
 *
 * <p><i>Behavioural transitions / flows (reference base behavioural rows):</i></p>
 * <ul>
 *   <li>state_transitions</li>
 *   <li>activity_flows</li>
 * </ul>
 *
 * <p><i>Sequence diagram children (sequence_diagram_id-scoped):</i></p>
 * <ul>
 *   <li>sequence_participants</li>
 *   <li>sequence_messages</li>
 *   <li>sequence_fragments</li>
 *   <li>sequence_operands</li>
 *   <li>sequence_nodes</li>
 * </ul>
 *
 * <p><i>UI workflow transitions (reference ui_screens):</i></p>
 * <ul>
 *   <li>ui_workflow_transitions</li>
 * </ul>
 *
 * <p><i>Diagram edges / interaction edges (reference diagram_nodes):</i></p>
 * <ul>
 *   <li>diagram_edges</li>
 *   <li>diagram_interaction_edges</li>
 * </ul>
 *
 * <p><b>PROJECT-DIRECT META-MODEL (already has project_id):</b></p>
 * <ul>
 *   <li>temporary_diagrams</li>
 * </ul>
 *
 * <h2>Excluded from clone</h2>
 * <p>Match spec #1's exclusion list for the {@code architecture_id} column
 * rollout. None of these are touched by {@link #cloneArchitecture}:</p>
 * <ul>
 *   <li><b>Threads</b> — file-based, project-scoped, not in DB.</li>
 *   <li><b>All {@code discovery_*} tables</b> — Discovery's own state;
 *       cloning would create misleading provenance.</li>
 *   <li><b>All project-scoped tables</b> — {@code project},
 *       {@code delivery_teams}, {@code organisations},
 *       {@code work_item*}, {@code project_artifact},
 *       {@code product_definitions}.</li>
 * </ul>
 *
 * <h2>FK rewiring strategy</h2>
 * <p>An in-memory {@code Map<String, String>} (oldId -> newId) is built as
 * each row is inserted. Because every in-scope table uses a TEXT primary
 * key holding a UUID string, and every FK to another in-scope row is also
 * a TEXT UUID string, the rewriter simply checks each non-id column value:
 * if it appears as a key in the map, the value is substituted with the
 * new id; otherwise it is preserved verbatim (handles non-FK columns and
 * cross-scope FKs like {@code project_id}). The map is per-call only —
 * it is never persisted and never leaked across requests.</p>
 *
 * <p><b>Hotfix #2 (project-id false-positive rewiring):</b> the spec #1
 * deterministic rule that the auto-created Default architecture's id
 * equals the owning project's id ({@code architecture.id == project.id})
 * means the source architecture's UUID can collide with a project UUID.
 * If that UUID is also placed into the FK rewiring map, every {@code
 * project_id} column whose value happens to equal the source architecture
 * id is silently rewritten to the new architecture id, which is not a
 * valid project UUID and triggers {@code "violates foreign key constraint
 * fk_model_files_project"}. The fix:</p>
 * <ol>
 *   <li>The source architecture id is NO LONGER inserted into
 *       {@code idMap} (it was previously added "defensively" — the
 *       {@code architecture_id} column is rewritten via an explicit
 *       branch anyway, so the map entry was redundant <i>and</i>
 *       caused this collision).</li>
 *   <li>The FK rewiring loop unconditionally passes {@link
 *       #NON_REWIRABLE_FK_COLUMNS} values through verbatim, regardless
 *       of whether the value happens to appear as a key in the map.
 *       {@code project_id} is the only non-id non-architecture-id
 *       column on any in-scope table that points at an out-of-scope
 *       row (verified by sweeping every {@code REFERENCES} clause on
 *       the 60 in-scope tables — see service Javadoc audit above).</li>
 * </ol>
 *
 * <h2>UUID column type-binding (PostgreSQL strict-mode hotfix)</h2>
 * <p>A small subset of columns are declared as native PostgreSQL
 * {@code uuid} (not TEXT): {@code architecture_id} on every in-scope table
 * (Liquibase 089) and {@code project_id} on {@code model_files} +
 * {@code temporary_diagrams}. PostgreSQL refuses {@code uuid = varchar}
 * comparisons strictly ({@code "operator does not exist: uuid = character
 * varying"}) — H2 in PostgreSQL mode silently coerces but real PG does
 * not. To keep the generic per-table copier portable, the discoverer now
 * captures the JDBC {@link Types} code per column and the binding helper
 * coerces String UUIDs to {@link UUID} objects at bind time for any
 * column whose declared type is {@code UUID} / {@code OTHER (uuid)}. The
 * FK detection branch likewise handles incoming values as either
 * {@code String} or {@code UUID} since PG returns native UUID columns as
 * {@link UUID} objects from {@link JdbcTemplate#queryForList}.</p>
 *
 * <h2>JPA persistence-context flush (Hotfix #3)</h2>
 *
 * <p>The new {@code architecture} row and its tag rows are persisted via
 * Spring Data JPA repositories ({@link ArchitectureRepository#saveAndFlush}
 * and {@link ArchitectureTagRepository#saveAndFlush}). The clone then
 * IMMEDIATELY follows up with raw {@link JdbcTemplate#batchUpdate} INSERTs
 * for every cloned in-scope row whose {@code architecture_id} FK references
 * the just-persisted architecture. Without an explicit flush, JPA only
 * places the new architecture in the persistence context — Hibernate
 * defers the actual SQL INSERT until commit time. PostgreSQL's FK check
 * fires on the raw JDBC INSERT and the architecture row is not yet in the
 * database, producing:</p>
 *
 * <pre>{@code
 * ERROR: insert or update on table "model_files" violates foreign key
 *   constraint "fk_model_files_architecture"
 *   Detail: Key (architecture_id)=(<new-arch-id>) is not present in
 *   table "architecture".
 * }</pre>
 *
 * <p>H2 in PostgreSQL mode does not surface the bug because the
 * integration-test {@code @SpringBootTest} fixture does not enforce
 * cross-statement FK timing strictly (the test connection sees the
 * pending insert through the same session). PostgreSQL is the
 * authoritative semantic — hence {@code saveAndFlush} on both
 * repositories.</p>
 *
 * <h2>Latent issues (documented, not fixed in Hotfix #3)</h2>
 *
 * <ol>
 *   <li><b>JSON-embedded UUIDs.</b> {@code diagram_nodes} has JSONB
 *       columns ({@code embedded_attribute_ids}, {@code selected_attribute_ids},
 *       {@code embedded_endpoint_ids}, {@code embedded_entity_ids}) that
 *       contain UUID arrays referencing logical_data_attribute / endpoint /
 *       entity ids. The column-name FK rewiring NEVER inspects JSON
 *       payloads, so the cloned diagram_nodes still hold UUIDs of the
 *       SOURCE architecture's child rows. The cloned diagram still
 *       renders — the JSON ids are interpreted as identity hints, not FKs
 *       — but cross-architecture editing of diagram embeddings is broken
 *       until a future spec walks the JSON. Documented as a follow-up;
 *       NOT blocking the user-visible "clone an architecture" flow.</li>
 *   <li><b>Audit timestamps.</b> {@code created_at} / {@code updated_at}
 *       columns are preserved verbatim from source. Conceptually a clone
 *       is a NEW set of rows that ought to carry the clone's timestamp,
 *       but no caller currently treats these as authoritative for the
 *       architecture lifecycle — the {@code architecture} row itself gets
 *       a fresh {@code created_at}, and that is what UI sorting uses
 *       (oldest non-archived = Default). Documented; no behavioural
 *       complaints to date.</li>
 *   <li><b>{@code is_default} on model_files.</b> Column is preserved
 *       verbatim. Spec #1 replaced the per-file "Default" concept with
 *       an architecture-level concept (oldest non-archived); the
 *       {@code is_default} column is now legacy noise and isn't read by
 *       any current code path. Documented; safe to leave as a verbatim
 *       copy.</li>
 *   <li><b>Auto-generated id columns.</b> Every in-scope table uses a
 *       TEXT primary key with application-generated UUIDs (no sequences,
 *       no identity columns). Verified by sweeping every {@code CREATE
 *       TABLE} statement; if a future migration introduces a serial /
 *       identity / UUID-DEFAULT column on an in-scope table, the clone
 *       will need bespoke handling because the explicit id binding will
 *       conflict with the DEFAULT.</li>
 *   <li><b>Composite primary keys.</b> The clone assumes a single
 *       {@code id} TEXT column. A scan of the in-scope set found no
 *       composite PKs; the only join tables present
 *       ({@code business_user_business_points},
 *       {@code application_point_business_points},
 *       {@code application_point_business_logics},
 *       {@code user_journey_links},
 *       {@code logical_data_entity_relationships},
 *       {@code logical_data_entity_physical_data_entities},
 *       {@code logical_data_attribute_physical_data_attributes},
 *       {@code interface_logical_entities}) all use a single TEXT id.</li>
 *   <li><b>Unique constraints.</b> Beyond the
 *       {@code model_files.filename} per-architecture composite (changeset
 *       096; spec #6 task 8.2), every other UNIQUE constraint on an
 *       in-scope table is keyed by {@code model_file_id} or another
 *       in-scope FK that the clone's per-table id-rewiring substitutes
 *       to a fresh id, so the cloned row trivially does not collide.
 *       Constraints scanned: {@code uq_sequence_operands_fragment_index
 *       (fragment_id, operand_index)}, {@code uq_app_point_business_logic
 *       (application_point_id, business_logic_id)}, {@code uq_package_set_name
 *       (package_set_id, name)}, {@code uq_packages_model_set_name
 *       (model_file_id, package_set_id, name)}, {@code uq_package_sets_standard
 *       (model_file_id, standard_source, standard_key)},
 *       {@code idx_data_entity_points_logical
 *       (model_file_id, logical_entity_id)}, and
 *       {@code idx_data_entity_points_physical
 *       (model_file_id, physical_entity_id)}.</li>
 *   <li><b>discovery_* and other out-of-scope FKs.</b> Verified that no
 *       in-scope table has a FK column pointing at any
 *       {@code discovery_*} / {@code work_item*} /
 *       {@code organisation} / {@code product_definition} table.
 *       Cloning therefore never orphans a reference from the new
 *       architecture into discovery / PM scopes. The {@code discovery_*}
 *       provenance link from a discovery_run to its architecture is
 *       maintained on the source's discovery_run rows (untouched, as
 *       discovery_run is not cloned per safety property (f)).</li>
 *   <li><b>Triggers / CHECK constraints.</b> The only non-FK CHECK in
 *       the in-scope set is {@code chk_data_entity_points_point_kind}
 *       and {@code chk_data_entity_points_exactly_one_fk} on
 *       {@code data_entity_points}. Both depend on per-row column values
 *       (not on FK identity); the clone preserves those values verbatim
 *       so the CHECKs continue to hold on the cloned rows.</li>
 * </ol>
 *
 * <p>Spec: Multi-Architecture Full Clone (Spec #6).</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ArchitectureCloneService {

    /**
     * In-scope tables in dependency order. See class Javadoc for the
     * authoritative scope description.
     *
     * <p>Order matters: every row in earlier tables must be cloned (and
     * registered in the old-to-new id map) before any row in a later
     * table is cloned, so dependent rows can have their FK columns
     * rewritten via the map.</p>
     *
     * <p><b>Hotfix #3 ordering audit.</b> Four cross-table FKs were
     * out-of-order in the previous list and are now corrected:</p>
     * <ul>
     *   <li>{@code services.package_set_id REFERENCES package_sets(id)} —
     *       package_sets / packages / package_set_default_rules /
     *       package_set_standards_import_status moved to BEFORE services.</li>
     *   <li>{@code endpoints.request_data_entity_point_id} +
     *       {@code endpoints.response_data_entity_point_id REFERENCES
     *       data_entity_points(id)} — data_entity_points (and the
     *       logical/physical data tables it depends on) moved to BEFORE
     *       endpoints.</li>
     *   <li>{@code ui_actions.contract_id REFERENCES ui_contracts(id)} —
     *       ui_contracts moved to BEFORE ui_actions.</li>
     *   <li>{@code activity_steps.application_id REFERENCES applications(id)}
     *       (and {@code business_user_id}, {@code process_activity_id},
     *       {@code user_journey_id}) — activity_steps moved to the
     *       DEPENDENT-rows section so every parent table is in the map
     *       before insertion.</li>
     * </ul>
     */
    static final List<String> IN_SCOPE_TABLES_IN_ORDER = List.of(
        // ROOT
        "model_files",

        // BUSINESS domain (base entities — activity_steps moved to dependents
        // because it references applications + process_activities +
        // business_users + user_journeys)
        "business_users",
        "business_processes",
        "process_activities",
        "business_points",
        "business_logics",
        "user_journeys",

        // DATA domain (base entities — moved BEFORE the application domain
        // because data_entity_points are referenced by endpoints, and the
        // logical/physical entity tables are referenced by data_entity_points)
        "logical_data_entities",
        "logical_data_attributes",
        "physical_data_entities",
        "physical_data_attributes",
        "data_entity_points",

        // APPLICATION domain (base entities — package_sets group moved to
        // BEFORE services because services.package_set_id references
        // package_sets(id))
        "applications",
        "application_components",
        "package_sets",
        "packages",
        "package_set_default_rules",
        "package_set_standards_import_status",
        "services",
        // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation):
        // libraries.package_set_id REFERENCES package_sets(id) (mirrors services).
        // No other table depends on libraries, so position is otherwise free.
        "libraries",
        "interfaces",
        "endpoints",
        "application_points",
        "classes",
        "methods",

        // INTERACTION domain (base entities)
        "app_business_points",
        "interactions",

        // BEHAVIOURAL domain (base entities)
        "events",
        "states",
        "activities",
        "activity_partitions",
        "sequence_diagrams",

        // UI domain (base entities — ui_contracts moved to BEFORE ui_actions
        // because ui_actions.contract_id references ui_contracts(id))
        "ui_screens",
        "ui_components",
        "ui_contracts",
        "ui_actions",
        "ui_characteristics",

        // DIAGRAM domain (base entities)
        "diagrams",
        "diagram_nodes",
        "diagram_decorations",

        // INFRASTRUCTURE domain (base entities — environments first because
        // every other Infra entity carries environment_id NOT NULL;
        // cloud_accounts second; locations third; networks then subnets;
        // clusters precede compute_resources; compute_resources precedes
        // deployment_units / listeners; infrastructure_points last in the
        // block because its 12 typed FKs reference the entity tables above)
        "environments",
        "cloud_accounts",
        "locations",
        "networks",
        "subnets",
        "compute_clusters",
        "compute_resources",
        "deployment_units",
        "load_balancers",
        "listeners",
        "data_store_instances",
        "infrastructure_resources",
        // INFRASTRUCTURE Terraform & Discovery Readiness (Spec:
        // 2026-05-05-infrastructure-terraform-discovery-readiness). iac_sources
        // is an entity-shaped concept depending only on environments + model_files;
        // placed in Block A after the 12 spec 1/2 Infra entity tables, before
        // infrastructure_points.
        "iac_sources",
        "infrastructure_points",

        // PROJECT-DIRECT meta-model
        "temporary_diagrams",

        // DEPENDENT rows (reference base entities — cloned after all
        // base-entity tables so FK rewiring via the old-to-new id map
        // always finds the parent)
        "business_user_business_points",
        "application_point_business_points",
        "application_point_business_logics",
        "user_journey_links",
        "activity_steps",
        "logical_data_entity_relationships",
        "logical_data_entity_physical_data_entities",
        "logical_data_attribute_physical_data_attributes",
        "data_movements",
        "interface_logical_entities",
        "state_transitions",
        "activity_flows",
        "sequence_participants",
        "sequence_messages",
        "sequence_fragments",
        "sequence_operands",
        "sequence_nodes",
        "ui_workflow_transitions",
        "diagram_edges",
        "diagram_interaction_edges",

        // INFRASTRUCTURE domain (relationship tables — cloned after every
        // base entity is in the id-map; all three reference
        // infrastructure_points plus other Infra entity tables)
        "resource_subnet_hostings",
        "deployment_unit_compute_resources",
        "load_balancer_resource_routes",

        // INFRASTRUCTURE cross-domain relationships (Spec:
        // 2026-05-05-infrastructure-cross-domain-integration). Cloned LAST
        // because they reference both Application/Data tables AND
        // Infrastructure entity tables, all of which must already be in the
        // id-map. Order amongst the 4 is independent (siblings).
        "application_compute_deployments",
        "data_entity_data_store_hostings",
        "application_infrastructure_resource_uses",
        "application_load_balancer_exposures",

        // INFRASTRUCTURE Terraform & Discovery Readiness (Spec:
        // 2026-05-05-infrastructure-terraform-discovery-readiness). Cloned at the
        // VERY END of Block B because iac_resource_bindings depends on iac_sources
        // (Block A) AND infrastructure_points (Block A) AND environments (Block A)
        // -- all of which must already be in the id-map.
        "iac_resource_bindings",

        // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation).
        // code_unit_dependencies references application_points (Block A); cloned
        // at the very end of Block B so all base entities are already in the
        // id-map.
        "code_unit_dependencies"
    );

    /**
     * Columns that must NEVER be substituted via the old-to-new id map.
     *
     * <p>Every column in this set holds an id that points at an
     * <b>out-of-scope</b> row (i.e. a row that is NOT being cloned). The
     * value in those columns must be preserved byte-for-byte so the
     * cloned row still references the original out-of-scope row.</p>
     *
     * <p>Audit (sweep of the 60 in-scope tables in
     * {@link #IN_SCOPE_TABLES_IN_ORDER} performed for hotfix #2):</p>
     * <ul>
     *   <li>{@code id} — handled by an earlier explicit branch, listed
     *       here for completeness in case the branch is ever
     *       refactored.</li>
     *   <li>{@code architecture_id} — also handled by an earlier
     *       explicit branch (rewritten to the NEW architecture id).</li>
     *   <li>{@code project_id} — present on {@code model_files} and
     *       {@code temporary_diagrams}; both tables reference
     *       {@code project(id)} which is OUT of scope (projects are
     *       never cloned). Without this exclusion, a clone of the
     *       Default architecture (whose id equals the project id by
     *       spec #1's deterministic rule) would rewire project_id to
     *       the new architecture id and trip
     *       {@code fk_model_files_project}.</li>
     * </ul>
     *
     * <p>No other column on any in-scope table references an
     * out-of-scope table. Specifically: no in-scope table has a
     * {@code work_item_id}, {@code organisation_id},
     * {@code delivery_team_id}, {@code product_definition_id} or
     * similar OUT-of-scope FK column — verified by grepping every
     * {@code ALTER TABLE ... ADD COLUMN} migration after the baseline
     * schema.sql, and re-confirming the baseline {@code REFERENCES}
     * clauses (the only cross-table FK on user_journeys is
     * {@code user_id REFERENCES business_users(id)}, which is
     * IN-scope and therefore correctly rewired).</p>
     *
     * <p>If a future migration adds a new out-of-scope FK column to
     * any in-scope table, it MUST be added to this set or the clone
     * will silently rewrite it to a non-existent id.</p>
     */
    static final Set<String> NON_REWIRABLE_FK_COLUMNS = Set.of(
        "id",
        "architecture_id",
        "project_id"
    );

    private final ArchitectureRepository architectureRepository;
    private final ArchitectureTagRepository architectureTagRepository;
    private final ArchitectureMapper architectureMapper;
    private final ArchitectureService architectureService;
    private final JdbcTemplate jdbcTemplate;

    public ArchitectureCloneService(ArchitectureRepository architectureRepository,
                                    ArchitectureTagRepository architectureTagRepository,
                                    ArchitectureMapper architectureMapper,
                                    ArchitectureService architectureService,
                                    JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.architectureTagRepository = architectureTagRepository;
        this.architectureMapper = architectureMapper;
        this.architectureService = architectureService;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Atomically clones {@code sourceArchitectureId} into a brand-new
     * architecture under the same project, copying every architecture-scoped
     * row from each in-scope table (see class Javadoc) with a freshly
     * generated id and FK references rewired via an in-memory old-to-new
     * id map.
     *
     * <p>Wrapped in a single {@link Transactional} boundary — any thrown
     * exception triggers a full rollback so partial state never persists.</p>
     *
     * @param projectId             project the source architecture must
     *                              belong to (cross-project access surfaces
     *                              as 404 via the standard pattern)
     * @param sourceArchitectureId  source architecture id to clone
     * @param name                  required, non-empty after trim,
     *                              {@code <= 100} chars, unique within
     *                              project (case-insensitive)
     * @param description           optional, {@code <= 500} chars
     * @param tags                  optional list; each tag non-empty
     *                              after trim, {@code <= 50} chars,
     *                              no duplicates within payload (start
     *                              empty by default per spec #6 decision #3)
     * @return the new architecture DTO, same shape as
     *         {@link ArchitectureService#create}
     * @throws ArchitectureNotFoundException
     *     if the source architecture id does not exist or does not belong
     *     to {@code projectId} (mapped to 404)
     * @throws ArchivedArchitectureSourceException
     *     if {@code source.archived == true} (mapped to 422
     *     {@code archived_source})
     * @throws IllegalArgumentException
     *     on validation failure (mapped to 400)
     * @throws DuplicateArchitectureNameException
     *     on name collision within the project (mapped to 409
     *     {@code duplicate_name})
     */
    @Transactional
    public ArchitectureDto cloneArchitecture(UUID projectId,
                                             UUID sourceArchitectureId,
                                             String name,
                                             String description,
                                             List<String> tags) {
        // Backward-compatible delegate -- no table exclusions (full graph clone).
        return cloneArchitecture(projectId, sourceArchitectureId, name, description, tags, Set.of());
    }

    /**
     * Overload accepting an explicit set of in-scope table names to EXCLUDE
     * from the clone walk.
     *
     * <p>Added for the Target State Sub-tab + Deterministic Suggest spec
     * (2026-05-24). The {@code SuggestFromCurrentService} delegates here with
     * a {@code excludedTables} set containing the diagram-domain tables so the
     * cloned target draft inherits every meta-model entity but no diagram
     * payload (matching the existing Selective Copy exclusion + the spec's
     * "drop Diagram View" decision).</p>
     *
     * <p>This is intentionally a thin parameter-plumbing extension: the clone
     * walk itself, FK rewiring, UUID-binding, and rollback semantics are
     * unchanged. A table named in {@code excludedTables} is simply skipped
     * during the {@link #IN_SCOPE_TABLES_IN_ORDER} loop.</p>
     *
     * <p>Names in {@code excludedTables} are matched case-insensitively against
     * the lower-cased entries in {@link #IN_SCOPE_TABLES_IN_ORDER}. Unknown
     * names (table names not in the in-scope list) are tolerated silently --
     * callers may pass an over-broad list without breaking the clone.</p>
     *
     * <p>Dependent rows that reference excluded base entities are still copied
     * if they themselves are not excluded; the FK rewiring map will not find
     * an entry for the excluded parent's id, so the dependent row's FK passes
     * through verbatim (a soft footgun the caller MUST avoid by excluding
     * matched parent + child tables together, as the Suggest service does for
     * the entire diagram domain).</p>
     *
     * @param excludedTables set of table names (lower-case) to skip during
     *                       the clone walk; pass {@link Set#of()} to clone
     *                       every in-scope table (the 5-arg overload does this)
     */
    @Transactional
    public ArchitectureDto cloneArchitecture(UUID projectId,
                                             UUID sourceArchitectureId,
                                             String name,
                                             String description,
                                             List<String> tags,
                                             Set<String> excludedTables) {
        return cloneArchitectureWithIdMap(
            projectId, sourceArchitectureId, name, description, tags, excludedTables).dto();
    }

    /**
     * Result of a clone: the new architecture DTO plus the {@code oldId -> newId}
     * correlation map built during the clone walk. The map lets callers (Suggest /
     * Seed) create {@code architecture_element_mappings} rows by STABLE id
     * correlation rather than by element name -- robust to duplicate names (e.g.
     * two {@code physical_data_attributes} called "ValidFrom") and able to map the
     * FK-only supertype tables that have no name column at all
     * ({@code data_entity_points}, {@code infrastructure_points}).
     */
    public record CloneResult(ArchitectureDto dto, Map<String, String> idMap) {}

    /**
     * Clone variant that also returns the source-to-clone id correlation map.
     * The plain {@code cloneArchitecture(...)} overloads delegate here and
     * discard the map.
     */
    @Transactional
    public CloneResult cloneArchitectureWithIdMap(UUID projectId,
                                             UUID sourceArchitectureId,
                                             String name,
                                             String description,
                                             List<String> tags,
                                             Set<String> excludedTables) {
        log.info("Cloning architecture {} in project {}: targetName='{}', excludedTables={}",
            sourceArchitectureId, projectId, name,
            excludedTables == null ? 0 : excludedTables.size());

        Set<String> normalisedExcluded = excludedTables == null
            ? Set.of()
            : excludedTables.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(s -> s.toLowerCase(Locale.ROOT).trim())
                .collect(java.util.stream.Collectors.toUnmodifiableSet());

        // 1. Load source architecture (404 if missing / cross-project).
        ArchitectureEntity source = architectureRepository.findById(sourceArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + sourceArchitectureId));
        if (!projectId.equals(source.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + sourceArchitectureId + " not found in project " + projectId);
        }

        // 2. Refuse archived source (defence-in-depth — UI also filters).
        if (Boolean.TRUE.equals(source.getArchived())) {
            log.warn("Refusing to clone archived source architecture {}", sourceArchitectureId);
            throw new ArchivedArchitectureSourceException();
        }

        // 3. Validate + trim payload (reuse spec #3 helpers).
        String trimmedName = architectureService.validateAndTrimName(name);
        String trimmedDescription = architectureService.validateAndTrimDescription(description);
        List<String> normalisedTags = architectureService.validateAndNormaliseTags(tags);

        // 4. Pre-flight duplicate-name check (the unique index from
        //    Liquibase 092 is the safety net for races; this check
        //    surfaces a friendly 409 with the offending name).
        if (architectureRepository.existsByProjectIdAndNameIgnoreCase(projectId, trimmedName)) {
            log.warn("Duplicate architecture name '{}' in project {}", trimmedName, projectId);
            throw new DuplicateArchitectureNameException(trimmedName);
        }

        // 5. Insert new architecture row + flush.
        //    Hotfix #3: saveAndFlush forces Hibernate to issue the SQL
        //    INSERT immediately so the raw JDBC FK checks below (against
        //    fk_model_files_architecture, fk_<table>_architecture, etc.)
        //    can see the new architecture row inside the same transaction.
        //    A plain save() defers the INSERT until commit, which makes
        //    PostgreSQL reject the very first batchUpdate INSERT on
        //    model_files with "violates foreign key constraint
        //    fk_model_files_architecture". H2 in PostgreSQL mode silently
        //    permits this because it does not enforce cross-statement FK
        //    timing strictly inside a single session — production PG is
        //    the authoritative semantic.
        UUID newArchitectureId = UUID.randomUUID();
        ArchitectureEntity newArch = ArchitectureEntity.builder()
            .id(newArchitectureId)
            .projectId(projectId)
            .name(trimmedName)
            .description(trimmedDescription)
            .archived(false)
            .build();
        ArchitectureEntity saved = architectureRepository.saveAndFlush(newArch);

        // 6. Insert tag rows + flush (defence-in-depth: keeps every
        //    JPA-managed write visible to the raw-JDBC layer).
        for (String tag : normalisedTags) {
            architectureTagRepository.save(ArchitectureTagEntity.builder()
                .architectureId(saved.getId())
                .tagValue(tag)
                .build());
        }
        if (!normalisedTags.isEmpty()) {
            architectureTagRepository.flush();
        }

        // 7. Build the in-memory old-to-new id map and clone every
        //    in-scope row, table by table, in dependency order. The map
        //    is local to this call — never persisted, never leaked.
        //
        //    Hotfix #2: do NOT pre-seed the map with sourceArchId ->
        //    newArchId. The architecture_id column is rewritten via
        //    its own explicit branch, so the map entry was redundant;
        //    and seeding it caused project_id columns whose value
        //    coincidentally equalled the source architecture id (i.e.
        //    every model_files row of the Default architecture, whose
        //    id equals project.id by spec #1) to be silently rewritten
        //    to the new architecture id, tripping the
        //    fk_model_files_project FK constraint in production
        //    PostgreSQL.
        Map<String, String> idMap = new HashMap<>();

        int clonedTableCount = 0;
        for (String table : IN_SCOPE_TABLES_IN_ORDER) {
            if (normalisedExcluded.contains(table.toLowerCase(Locale.ROOT))) {
                log.debug("Skipping excluded table '{}' for clone of {} -> {}",
                    table, sourceArchitectureId, newArchitectureId);
                continue;
            }
            cloneTableRows(table, sourceArchitectureId, newArchitectureId, idMap);
            clonedTableCount++;
        }

        log.info("Cloned architecture {} -> {} (project={}, tables={} of {}, excluded={}, mappedIds={})",
            sourceArchitectureId, newArchitectureId, projectId,
            clonedTableCount, IN_SCOPE_TABLES_IN_ORDER.size(),
            normalisedExcluded.size(), idMap.size());

        ArchitectureDto dto = architectureMapper.toDto(
            saved,
            architectureTagRepository.findByArchitectureId(saved.getId()));
        return new CloneResult(dto, Map.copyOf(idMap));
    }

    /**
     * Clones every row in {@code table} that belongs to the source architecture
     * -- scoped either by a direct {@code architecture_id} column or, for the
     * model-file-anchored tables that lack it (libraries + infrastructure), by
     * {@code model_file_id -> model_files.architecture_id} -- generating a fresh
     * id, registering the old-to-new mapping, and rewriting any column value
     * that already appears as a key in the {@code idMap} via the map.
     *
     * <p>Two-pass within the table:</p>
     * <ol>
     *   <li>SELECT all source rows + register a fresh id for each row's
     *       primary key in {@code idMap} BEFORE any insert. This means
     *       intra-table FKs (e.g. a {@code business_processes} row's
     *       {@code business_process_id} self-reference, if any) are
     *       discoverable in the map at insert time.</li>
     *   <li>INSERT each row, substituting any column value that matches
     *       a map key with its new id; rewriting {@code architecture_id}
     *       to the new architecture id; preserving everything else
     *       (description, name, dates, JSON columns, project_id, etc.)
     *       verbatim.</li>
     * </ol>
     *
     * <p>If the target table does not exist (e.g. older H2 fixture in a
     * unit test that omits some tables), the method logs and skips. This
     * keeps the implementation resilient when fixtures are partial — the
     * production schema always has every in-scope table.</p>
     */
    private void cloneTableRows(String table,
                                UUID sourceArchitectureId,
                                UUID newArchitectureId,
                                Map<String, String> idMap) {
        Map<String, Integer> columnTypes = discoverColumnTypes(table);
        if (columnTypes.isEmpty()) {
            log.debug("Table '{}' has no discoverable columns (skipped)", table);
            return;
        }
        if (!columnTypes.containsKey("id")) {
            log.warn("Table '{}' has no 'id' column — skipping clone", table);
            return;
        }
        // Scope source rows to the architecture. Most in-scope tables carry a
        // denormalised `architecture_id` (changeset 089). Tables added AFTER 089
        // -- `libraries` and the whole infrastructure domain (environments,
        // cloud_accounts, locations, networks + their children) -- deliberately
        // do NOT; they anchor to the architecture through
        // `model_file_id -> model_files.architecture_id` (the same model-file
        // chain `ArchitectureScopeResolver` uses). Clone BOTH shapes so the
        // cloned target is a complete 1:1 copy. Previously a missing
        // `architecture_id` column silently skipped the table, dropping infra +
        // libraries from every clone (and from Suggest-from-current).
        final String whereClause;
        if (columnTypes.containsKey("architecture_id")) {
            whereClause = " WHERE architecture_id = ?";
        } else if (columnTypes.containsKey("model_file_id")) {
            whereClause =
                " WHERE model_file_id IN (SELECT id FROM model_files WHERE architecture_id = ?)";
        } else {
            log.warn("Table '{}' has neither 'architecture_id' nor 'model_file_id' -- "
                + "cannot scope it to an architecture; skipping clone", table);
            return;
        }
        List<String> columns = new ArrayList<>(columnTypes.keySet());

        // Build "SELECT col1, col2, ... FROM table <whereClause>". The single
        // bind parameter is the source architecture id in both scoping shapes.
        String selectColumns = String.join(", ", columns);
        String selectSql = "SELECT " + selectColumns + " FROM " + table + whereClause;

        // Bind sourceArchitectureId as a UUID object (not a String). PostgreSQL
        // strictly rejects `uuid = varchar` comparisons; H2 silently coerces.
        List<Map<String, Object>> rows =
            jdbcTemplate.queryForList(selectSql, sourceArchitectureId);
        if (rows.isEmpty()) {
            log.debug("Table '{}' has no rows for source architecture {}", table, sourceArchitectureId);
            return;
        }

        // PASS 1: register fresh ids in the map.
        List<String> oldIds = new ArrayList<>(rows.size());
        List<String> newIds = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            Object oldIdObj = row.get("id");
            if (oldIdObj == null) {
                throw new IllegalStateException(
                    "Table '" + table + "' has a row with NULL id");
            }
            String oldId = oldIdObj.toString();
            String newId = UUID.randomUUID().toString();
            oldIds.add(oldId);
            newIds.add(newId);
            idMap.put(oldId, newId);
        }

        // PASS 2: build INSERTs with FK rewiring + UUID-typed column coercion.
        String insertSql = "INSERT INTO " + table + " (" + selectColumns
            + ") VALUES (" + String.join(", ", Collections.nCopies(columns.size(), "?")) + ")";

        List<Object[]> batchArgs = new ArrayList<>(rows.size());
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> row = rows.get(i);
            Object[] args = new Object[columns.size()];
            for (int c = 0; c < columns.size(); c++) {
                String col = columns.get(c);
                int sqlType = columnTypes.getOrDefault(col, Types.OTHER);
                Object value = row.get(col);
                Object resolved;
                if ("id".equals(col)) {
                    resolved = newIds.get(i);
                } else if ("architecture_id".equals(col)) {
                    resolved = newArchitectureId;
                } else if (NON_REWIRABLE_FK_COLUMNS.contains(col)) {
                    // project_id (and any future out-of-scope FK column
                    // listed in NON_REWIRABLE_FK_COLUMNS) must pass
                    // through verbatim — never substituted via the
                    // old-to-new id map. Hotfix #2: prevents the
                    // Default-architecture-id == project-id collision
                    // from rewriting project_id to a non-existent
                    // architecture id and tripping
                    // fk_model_files_project.
                    resolved = value;
                } else {
                    // FK rewiring — the incoming value can be a String (TEXT
                    // id columns) OR a UUID (PostgreSQL UUID columns). Handle
                    // both shapes so PG and H2 behave identically.
                    String idStr = stringifyIdLike(value);
                    if (idStr != null && idMap.containsKey(idStr)) {
                        resolved = idMap.get(idStr);
                    } else {
                        resolved = value;
                    }
                }
                args[c] = coerceForSqlType(resolved, sqlType);
            }
            batchArgs.add(args);
        }

        int[] inserted = jdbcTemplate.batchUpdate(insertSql, batchArgs);
        log.debug("Cloned {} rows in table '{}'", inserted.length, table);
    }

    /**
     * Returns the supplied value as a String iff it is a {@link String} or
     * a {@link UUID}; returns {@code null} otherwise. Used by the FK
     * rewiring branch so values returned as {@code UUID} from a native PG
     * uuid column are still recognisable as map keys (the map is keyed by
     * stringified UUIDs).
     */
    private static String stringifyIdLike(Object value) {
        if (value == null) return null;
        if (value instanceof UUID u) return u.toString();
        if (value instanceof String s) return s;
        return null;
    }

    /**
     * Coerces a resolved column value to the type the JDBC driver expects
     * for the column's declared SQL type. Today this only matters for
     * {@code UUID} / {@code OTHER (uuid)} columns: PostgreSQL strictly
     * rejects binding a {@link String} against a native {@code uuid}
     * column. For every other SQL type the value is passed through
     * verbatim — the JDBC driver handles type-correct values returned
     * directly from a SELECT (timestamps, JSON, integers, etc.) without
     * any further marshalling.
     */
    static Object coerceForSqlType(Object value, int sqlType) {
        if (value == null) return null;
        if (isUuidSqlType(sqlType)) {
            if (value instanceof UUID) return value;
            if (value instanceof String s) {
                if (s.isEmpty()) return null;
                try {
                    return UUID.fromString(s);
                } catch (IllegalArgumentException ex) {
                    // The column is declared UUID but the value isn't a
                    // valid UUID string; let the JDBC driver surface the
                    // error so we don't silently swallow data corruption.
                    return s;
                }
            }
        }
        return value;
    }

    static boolean isUuidSqlType(int sqlType) {
        // PostgreSQL JDBC reports UUID columns as Types.OTHER (typeName
        // "uuid"); H2 reports them as Types.OTHER (typeName "UUID") on
        // older versions and a dedicated Types.UUID-equivalent (1111
        // / 2000-range) on newer versions. Match all of the codes we
        // could plausibly see.
        return sqlType == Types.OTHER
            || sqlType == Types.JAVA_OBJECT
            // java.sql.Types does not declare a UUID constant in JDK 17,
            // but JDBC drivers use the JDBC 4.2-defined constant 2000
            // (Types.JAVA_OBJECT) or the historical -2147483648 sentinel
            // some H2 versions emit. Hard-code the well-known values.
            || sqlType == 2000;
    }

    /**
     * Discovers the list of column names + JDBC SQL types for {@code table}
     * via JDBC {@link DatabaseMetaData}. Returns an empty map if the table
     * does not exist (so callers can skip gracefully in partial fixtures).
     *
     * <p>Iteration order is preserved (LinkedHashMap) so callers can rely
     * on the same order for SELECT and INSERT column lists.</p>
     */
    private Map<String, Integer> discoverColumnTypes(String table) {
        DataSource ds = jdbcTemplate.getDataSource();
        if (ds == null) {
            throw new IllegalStateException("JdbcTemplate has no DataSource");
        }
        try (Connection conn = ds.getConnection()) {
            DatabaseMetaData md = conn.getMetaData();
            // Try lower-case (PostgreSQL default) first, then upper-case
            // (H2 default for unquoted identifiers).
            Map<String, Integer> columns = readColumnTypes(md, table);
            if (columns.isEmpty()) {
                columns = readColumnTypes(md, table.toUpperCase(Locale.ROOT));
            }
            return columns;
        } catch (SQLException e) {
            throw new IllegalStateException(
                "Failed to discover columns for table '" + table + "': " + e.getMessage(), e);
        }
    }

    private Map<String, Integer> readColumnTypes(DatabaseMetaData md, String table) throws SQLException {
        // LinkedHashMap preserves driver-reported order (table-definition
        // order in PG and H2) and de-dupes if a driver surfaces the same
        // column twice across schemas.
        Map<String, Integer> ordered = new LinkedHashMap<>();
        try (ResultSet rs = md.getColumns(null, null, table, null)) {
            while (rs.next()) {
                String name = rs.getString("COLUMN_NAME");
                if (name == null) continue;
                String lower = name.toLowerCase(Locale.ROOT);
                if (ordered.containsKey(lower)) continue;
                int type = rs.getInt("DATA_TYPE");
                String typeName = rs.getString("TYPE_NAME");
                // Some H2 versions report UUID columns as Types.BINARY
                // (-2) with TYPE_NAME = "UUID"; normalise to Types.OTHER
                // so the bind-time coercion fires consistently.
                if (typeName != null && "uuid".equalsIgnoreCase(typeName.trim())) {
                    type = Types.OTHER;
                }
                ordered.put(lower, type);
            }
        }
        return ordered;
    }
}
