package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.model.dto.ElementInventoryResponse;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for {@link ArchitectureElementInventoryService}.
 *
 * Mirrors the lightweight {@link ArchitectureCloneServiceTest} approach
 * (mocked {@link JdbcTemplate} + mocked {@link DatabaseMetaData}) so the
 * tests run in milliseconds and do not require seeding the full 60-table
 * H2 schema. The Group 4 integration test (per the task plan) exercises
 * the full graph against a real database; this layer asserts only the
 * domain shape, ordering, and 404 behaviour.
 *
 * Tests:
 *   1. Domain ordering — the six canonical domains come back in the
 *      render order [Applications, Data, Business, UI, Behavioural,
 *      Diagrams] regardless of which tables actually have rows.
 *   2. Empty architecture — every domain is present with an empty types
 *      list (no nulls / no missing keys).
 *   3. Type grouping — instances of the same entity type collapse under
 *      one type node within a domain (e.g. two applications appear as
 *      two instances inside one Applications type within the
 *      Applications domain).
 *   4. 404 when the architecture does not exist.
 *   5. 404 when the architecture exists but belongs to another project.
 *
 * Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)
 * Task Group 1: Backend element inventory service + endpoint (Task 1.1)
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureElementInventoryServiceTest {

    @Mock
    private ArchitectureRepository architectureRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private DataSource dataSource;

    @Mock
    private Connection connection;

    @Mock
    private DatabaseMetaData databaseMetaData;

    @Mock
    private ResultSet columnsResultSet;

    private ArchitectureElementInventoryService inventoryService;

    private UUID projectId;
    private UUID architectureId;

    @BeforeEach
    void setUp() throws Exception {
        projectId = UUID.randomUUID();
        architectureId = UUID.randomUUID();

        inventoryService = new ArchitectureElementInventoryService(
            architectureRepository, jdbcTemplate);

        // JDBC scaffolding for the tableHasNameColumn probe. By default
        // every table reports having no columns, so the service falls
        // back to id-only display. Tests that want to assert name
        // resolution override this on a per-table basis below.
        // Marked lenient because the 404 tests never reach JDBC.
        lenient().when(jdbcTemplate.getDataSource()).thenReturn(dataSource);
        lenient().when(dataSource.getConnection()).thenReturn(connection);
        lenient().when(connection.getMetaData()).thenReturn(databaseMetaData);
        lenient().when(databaseMetaData.getColumns(any(), any(), anyString(), any()))
            .thenReturn(columnsResultSet);
        lenient().when(columnsResultSet.next()).thenReturn(false);

        // Default: every table query returns empty rows. Specific tests
        // override individual tables.
        lenient().when(jdbcTemplate.queryForList(anyString(), any(Object[].class)))
            .thenReturn(List.of());
    }

    /**
     * Test 1: Domain ordering.
     *
     * The six canonical domains MUST come back in the picker render order
     * {@code [Applications, Data, Business, UI, Behavioural, Diagrams]}.
     * Spec #7 picker tree depends on this ordering — a frontend that
     * iterates the response straight to render must get the domains in
     * the right order.
     */
    @Test
    @DisplayName("inventory returns the six canonical domains in render order")
    void testDomainOrderingIsCanonical() {
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(architectureId)
            .projectId(projectId)
            .name("Current State")
            .archived(false)
            .build();
        when(architectureRepository.findById(architectureId))
            .thenReturn(Optional.of(arch));

        ElementInventoryResponse response =
            inventoryService.getInventory(projectId, architectureId);

        assertThat(response).isNotNull();
        assertThat(response.domains())
            .extracting(ElementInventoryResponse.Domain::name)
            .containsExactly(
                "Applications",
                "Data",
                "Business",
                "UI",
                "Behavioural",
                "Infrastructure",
                "Diagrams");
    }

    /**
     * Test 2: Empty-architecture path.
     *
     * An architecture with zero rows in every in-scope table still
     * returns the seven domain shells (no nulls / no missing keys). Each
     * domain's {@code types} list is empty (since no table had rows for
     * the given architecture).
     */
    @Test
    @DisplayName("inventory for an empty architecture returns six empty domain shells")
    void testEmptyArchitectureReturnsAllDomainShells() {
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(architectureId)
            .projectId(projectId)
            .name("Empty")
            .archived(false)
            .build();
        when(architectureRepository.findById(architectureId))
            .thenReturn(Optional.of(arch));

        ElementInventoryResponse response =
            inventoryService.getInventory(projectId, architectureId);

        assertThat(response.domains()).hasSize(7);
        for (ElementInventoryResponse.Domain domain : response.domains()) {
            assertThat(domain.name()).isNotNull();
            assertThat(domain.types())
                .as("Domain '%s' types list is non-null + empty", domain.name())
                .isNotNull()
                .isEmpty();
        }
    }

    /**
     * Test 3: Type grouping.
     *
     * Two applications (rows in the {@code applications} table) MUST
     * appear under a single Applications type node within the
     * Applications domain. Verifies the per-domain table-list partition
     * and the per-table SELECT shape collapse correctly.
     */
    @Test
    @DisplayName("multiple rows of one entity type collapse under a single type node")
    void testTypeGroupingCollapsesPerEntityType() throws Exception {
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(architectureId)
            .projectId(projectId)
            .name("With Apps")
            .archived(false)
            .build();
        when(architectureRepository.findById(architectureId))
            .thenReturn(Optional.of(arch));

        // Pretend the applications table has a name column so the
        // service issues "SELECT id, name". For all other tables the
        // default scaffolding returns false from columnsResultSet.next()
        // and the SELECT degrades to "SELECT id" with empty results.
        ResultSet applicationsColumns = org.mockito.Mockito.mock(ResultSet.class);
        when(applicationsColumns.next()).thenReturn(true, true, false);
        when(applicationsColumns.getString("COLUMN_NAME"))
            .thenReturn("id", "name");
        when(databaseMetaData.getColumns(any(), any(), eq("applications"), any()))
            .thenReturn(applicationsColumns);

        // Two rows for applications, zero for everything else (default).
        UUID app1Id = UUID.randomUUID();
        UUID app2Id = UUID.randomUUID();
        when(jdbcTemplate.queryForList(
                startsWith("SELECT t.id, t.name FROM applications"),
                any(Object[].class)))
            .thenReturn(List.of(
                Map.of("id", app1Id.toString(), "name", "Order Service"),
                Map.of("id", app2Id.toString(), "name", "Inventory Service")
            ));

        ElementInventoryResponse response =
            inventoryService.getInventory(projectId, architectureId);

        ElementInventoryResponse.Domain applicationsDomain = response.domains().stream()
            .filter(d -> d.name().equals("Applications"))
            .findFirst()
            .orElseThrow();

        // Only the applications table has rows -> exactly one type node.
        assertThat(applicationsDomain.types()).hasSize(1);
        ElementInventoryResponse.Type applicationsType = applicationsDomain.types().get(0);
        assertThat(applicationsType.entityType()).isEqualTo("applications");
        assertThat(applicationsType.name()).isEqualTo("Applications");

        // Both rows collapsed under the single type node.
        assertThat(applicationsType.instances())
            .extracting(ElementInventoryResponse.Instance::name)
            .containsExactly("Order Service", "Inventory Service");
        assertThat(applicationsType.instances())
            .extracting(ElementInventoryResponse.Instance::id)
            .containsExactly(app1Id.toString(), app2Id.toString());
    }

    /**
     * Test 4: 404 when the architecture does not exist.
     *
     * Mapped to HTTP 404 by {@code GlobalExceptionHandler} via
     * {@link ArchitectureNotFoundException}'s superclass.
     */
    @Test
    @DisplayName("inventory throws ArchitectureNotFoundException when id is missing")
    void testThrowsWhenArchitectureMissing() {
        when(architectureRepository.findById(architectureId))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() ->
                inventoryService.getInventory(projectId, architectureId))
            .isInstanceOf(ArchitectureNotFoundException.class)
            .hasMessageContaining(architectureId.toString());
    }

    /**
     * Test 5: 404 when the architecture exists but belongs to another
     * project. Mirrors the cross-project-safety pattern from
     * {@link ArchitectureCloneService} — cross-project access is treated
     * as "not found" to avoid leaking the existence of architectures the
     * caller cannot see.
     */
    @Test
    @DisplayName("inventory throws ArchitectureNotFoundException when architecture belongs to another project")
    void testThrowsWhenArchitectureCrossProject() {
        UUID otherProjectId = UUID.randomUUID();
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(architectureId)
            .projectId(otherProjectId)
            .name("Foreign")
            .archived(false)
            .build();
        when(architectureRepository.findById(architectureId))
            .thenReturn(Optional.of(arch));

        assertThatThrownBy(() ->
                inventoryService.getInventory(projectId, architectureId))
            .isInstanceOf(ArchitectureNotFoundException.class)
            .hasMessageContaining("not found in project");
    }
}
