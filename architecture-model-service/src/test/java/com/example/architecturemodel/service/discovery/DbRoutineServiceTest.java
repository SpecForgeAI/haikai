package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.model.dto.UpsertDbRoutinesRequest;
import com.example.architecturemodel.model.dto.UpsertDbRoutinesRequest.RoutineRecordDto;
import com.example.architecturemodel.model.entity.discovery.DbRoutineEntity;
import com.example.architecturemodel.repository.entity.DbRoutineRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Spec 1 (Stored Proc &amp; Function Behaviour Program, 2026-09-09): the
 * routine-catalog bulk upsert matches by natural key (stable ids across
 * re-scans), inserts new routines, skips malformed records, and never
 * deletes rows that vanished from the live catalog.
 */
@ExtendWith(MockitoExtension.class)
class DbRoutineServiceTest {

    @Mock
    private DbRoutineRepository repository;

    private static RoutineRecordDto record(String name, String kind, String hash) {
        return new RoutineRecordDto(
            "dbo", name, kind, "TSQL", "create proc " + name + " as select 1", hash, "md5",
            List.of(Map.of("name", "id", "ordinal", 1, "source_type", "int", "direction", "in")),
            null, null, List.of(), Map.of("max_result_sets", 1),
            List.of("ledger_line"), List.of("ledger_ctrl"), List.of(),
            List.of("ledger_line"), List.of("ledger_ctrl"), List.of(),
            "live", true, null);
    }

    @Test
    @DisplayName("existing rows are updated in place (id stable), new ones inserted, malformed skipped")
    void upsertMatchesNaturalKeyAndInsertsNew() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID existingId = UUID.randomUUID();
        DbRoutineEntity existing = DbRoutineEntity.builder()
            .id(existingId).projectId(projectId).architectureId(architectureId)
            .schemaName("dbo").routineName("upd_ledger_roll").routineKind("procedure")
            .fullBody("old body").bodyHash("old-hash").build();
        when(repository.findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(architectureId))
            .thenReturn(List.of(existing));

        DbRoutineService service = new DbRoutineService(repository);
        UpsertDbRoutinesRequest request = new UpsertDbRoutinesRequest(UUID.randomUUID(), List.of(
            record("UPD_LEDGER_ROLL", "procedure", "new-hash"),
            record("fn_ledger_total", "function", "fn-hash"),
            record("broken", "widget", "x")
        ));

        int upserted = service.bulkUpsert(projectId, architectureId, request);

        assertThat(upserted).isEqualTo(2);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DbRoutineEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(repository).saveAll(captor.capture());
        List<DbRoutineEntity> saved = captor.getValue();
        assertThat(saved).hasSize(2);
        DbRoutineEntity updated = saved.stream()
            .filter(e -> "upd_ledger_roll".equals(e.getRoutineName())).findFirst().orElseThrow();
        assertThat(updated.getId()).isEqualTo(existingId);
        assertThat(updated.getBodyHash()).isEqualTo("new-hash");
        assertThat(updated.getWritesClosureJson()).containsExactly("ledger_ctrl");
        DbRoutineEntity inserted = saved.stream()
            .filter(e -> "fn_ledger_total".equals(e.getRoutineName())).findFirst().orElseThrow();
        assertThat(inserted.getRoutineKind()).isEqualTo("function");
        assertThat(inserted.getProjectId()).isEqualTo(projectId);
    }

    @Test
    @DisplayName("an empty request saves nothing and reports zero")
    void emptyRequestIsNoop() {
        UUID architectureId = UUID.randomUUID();
        when(repository.findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(any()))
            .thenReturn(List.of());
        DbRoutineService service = new DbRoutineService(repository);
        int upserted = service.bulkUpsert(UUID.randomUUID(), architectureId,
            new UpsertDbRoutinesRequest(null, List.of()));
        assertThat(upserted).isZero();
        verify(repository).saveAll(List.of());
    }
}
