package com.example.architecturemodel.model.dto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Contract test for {@link MigrationDeliveryDashboardDto} and the sibling
 * Migration Delivery DTO records authored in Task Group 2 of the
 * Migration Delivery Progress and Evidence Tracking spec (2026-05-19).
 *
 * <p>Asserts the exact field set on the dashboard record matches what
 * downstream callers (gateway proxy, frontend client, frontend tree+drawer
 * components) expect. Per tasks.md test 2.1 the dashboard record must expose
 * exactly the following 16 fields:</p>
 * <ul>
 *   <li>{@code bookOfWorkId}</li>
 *   <li>{@code projectId}</li>
 *   <li>{@code currentArchitectureId}</li>
 *   <li>{@code targetArchitectureId}</li>
 *   <li>{@code title}</li>
 *   <li>{@code status}</li>
 *   <li>{@code generatedAt}</li>
 *   <li>{@code summary}</li>
 *   <li>{@code hierarchy}</li>
 *   <li>{@code workstreamSummaries}</li>
 *   <li>{@code specGenerationSummary}</li>
 *   <li>{@code backlogSaveSummary}</li>
 *   <li>{@code implementationSummary}</li>
 *   <li>{@code evidenceSummary}</li>
 *   <li>{@code needsAttention}</li>
 *   <li>{@code warnings}</li>
 * </ul>
 *
 * <p>Also asserts the optional Addition C surfacing path:
 * {@link MigrationDeliveryNeedsAttentionItemDto#missingInputs()} exists and
 * resolves to a {@code List<MissingInputEntry>}, and
 * {@link MigrationDeliveryHierarchyNodeDto#missingInputsCount()} exists.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AMS test 19 / tasks.md Test 2.1.</p>
 */
class MigrationDeliveryDashboardDtoContractTest {

    @Test
    @DisplayName("MigrationDeliveryDashboardDto exposes exactly the 16 contract fields")
    void dashboardDtoExposesExactContractFieldSet() {
        Set<String> expected = new HashSet<>(Arrays.asList(
            "bookOfWorkId",
            "projectId",
            "currentArchitectureId",
            "targetArchitectureId",
            "title",
            "status",
            "generatedAt",
            "summary",
            "hierarchy",
            "workstreamSummaries",
            "specGenerationSummary",
            "backlogSaveSummary",
            "implementationSummary",
            "evidenceSummary",
            "needsAttention",
            "warnings"
        ));

        Set<String> actual = Arrays.stream(MigrationDeliveryDashboardDto.class.getRecordComponents())
            .map(RecordComponent::getName)
            .collect(Collectors.toSet());

        assertThat(actual)
            .as("MigrationDeliveryDashboardDto must expose exactly the contract field set")
            .isEqualTo(expected);
    }

    @Test
    @DisplayName("MigrationDeliveryDashboardDto is an immutable Java record (no setters)")
    void dashboardDtoIsAnImmutableRecord() {
        assertThat(MigrationDeliveryDashboardDto.class.isRecord())
            .as("MigrationDeliveryDashboardDto must be a record (no setters, immutable)")
            .isTrue();

        // All sibling DTOs must also be records.
        assertThat(MigrationDeliverySummaryDto.class.isRecord()).isTrue();
        assertThat(MigrationDeliveryHierarchyNodeDto.class.isRecord()).isTrue();
        assertThat(MigrationDeliveryWorkstreamSummaryDto.class.isRecord()).isTrue();
        assertThat(MigrationDeliveryNeedsAttentionItemDto.class.isRecord()).isTrue();
        assertThat(MigrationDeliverySpecGenerationSummaryDto.class.isRecord()).isTrue();
        assertThat(MigrationDeliveryBacklogSaveSummaryDto.class.isRecord()).isTrue();
        assertThat(MigrationDeliveryImplementationSummaryDto.class.isRecord()).isTrue();
        assertThat(MigrationDeliveryEvidenceSummaryDto.class.isRecord()).isTrue();
        assertThat(MissingInputEntry.class.isRecord()).isTrue();
    }

    @Test
    @DisplayName("MigrationDeliveryNeedsAttentionItemDto.missingInputs exists and resolves to List<MissingInputEntry> (Addition C)")
    void needsAttentionItemSurfacesOptionalMissingInputsList() throws NoSuchMethodException {
        RecordComponent missingInputs = Arrays.stream(
            MigrationDeliveryNeedsAttentionItemDto.class.getRecordComponents())
            .filter(rc -> "missingInputs".equals(rc.getName()))
            .findFirst()
            .orElseThrow(() -> new AssertionError(
                "MigrationDeliveryNeedsAttentionItemDto must expose a missingInputs field (Addition C)"));

        // Type signature must be List<MissingInputEntry>.
        assertThat(missingInputs.getType())
            .as("missingInputs must be a List (Addition C surfaces missing_inputs_json[] verbatim)")
            .isEqualTo(List.class);

        String generic = missingInputs.getGenericType().getTypeName();
        assertThat(generic)
            .as("missingInputs generic parameter must be MissingInputEntry")
            .contains("MissingInputEntry");
    }

    @Test
    @DisplayName("MigrationDeliveryHierarchyNodeDto.missingInputsCount exists (Addition C)")
    void hierarchyNodeSurfacesMissingInputsCount() {
        boolean hasMissingInputsCount = Arrays.stream(
            MigrationDeliveryHierarchyNodeDto.class.getRecordComponents())
            .anyMatch(rc -> "missingInputsCount".equals(rc.getName()));

        assertThat(hasMissingInputsCount)
            .as("MigrationDeliveryHierarchyNodeDto must expose a missingInputsCount field (Addition C)")
            .isTrue();
    }

    @Test
    @DisplayName("MissingInputEntry exposes exactly { kind, id, reason } (verbatim from missing_inputs_json[])")
    void missingInputEntryExposesContractFieldSet() {
        Set<String> expected = new HashSet<>(Arrays.asList("kind", "id", "reason"));

        Set<String> actual = Arrays.stream(MissingInputEntry.class.getRecordComponents())
            .map(RecordComponent::getName)
            .collect(Collectors.toSet());

        assertThat(actual)
            .as("MissingInputEntry must expose exactly { kind, id, reason } verbatim from missing_inputs_json[]")
            .isEqualTo(expected);
    }
}
