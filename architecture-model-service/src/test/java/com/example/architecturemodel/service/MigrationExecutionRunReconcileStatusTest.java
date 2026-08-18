package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.MigrationExecutionRunDto;
import com.example.architecturemodel.model.entity.MigrationExecutionRunEntity;
import com.example.architecturemodel.model.entity.MigrationExecutionRunStatus;
import com.example.architecturemodel.repository.entity.MigrationExecutionRunItemRepository;
import com.example.architecturemodel.repository.entity.MigrationExecutionRunRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Regression: the gateway reconcile driver (Spec 2026-06-14, Spec 4 of 4)
 * writes {@code reconciling} / {@code reconciled} /
 * {@code needs_target_credentials} / {@code reconcile_failed} through the run
 * PATCH route — but those values were never registered in
 * {@link MigrationExecutionRunStatus#ALL}, so EVERY reconcile-status write
 * 400'd (found live 2026-08-17: the run could never show a reconcile state
 * and the driver's RECONCILING idempotency latch was never persisted).
 */
@ExtendWith(MockitoExtension.class)
class MigrationExecutionRunReconcileStatusTest {

    @Mock
    private MigrationExecutionRunRepository runRepository;

    @Mock
    private MigrationExecutionRunItemRepository runItemRepository;

    @InjectMocks
    private MigrationExecutionRunService service;

    private static final UUID RUN_ID = UUID.randomUUID();

    private MigrationExecutionRunDto patchDto(String status) {
        // Back-compat 11-arg constructor: only the status participates here.
        return new MigrationExecutionRunDto(
            null, null, null, status, null, null, null, null, null, null, null);
    }

    private void stubRun() {
        MigrationExecutionRunEntity entity = MigrationExecutionRunEntity.builder()
            .id(RUN_ID)
            .status(MigrationExecutionRunStatus.DEPLOYED)
            .build();
        lenient().when(runRepository.findById(RUN_ID)).thenReturn(Optional.of(entity));
        lenient().when(runRepository.save(any(MigrationExecutionRunEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    @DisplayName("ALL registers the four Spec-4 reconcile statuses")
    void allContainsReconcileStatuses() {
        assertThat(MigrationExecutionRunStatus.ALL).contains(
            MigrationExecutionRunStatus.RECONCILING,
            MigrationExecutionRunStatus.RECONCILED,
            MigrationExecutionRunStatus.NEEDS_TARGET_CREDENTIALS,
            MigrationExecutionRunStatus.RECONCILE_FAILED);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "reconciling", "reconciled", "needs_target_credentials", "reconcile_failed"
    })
    @DisplayName("PATCH run accepts each reconcile status (no 400)")
    void updateRunAcceptsReconcileStatuses(String status) {
        stubRun();
        MigrationExecutionRunDto updated = service.updateRun(RUN_ID, patchDto(status));
        assertThat(updated.status()).isEqualTo(status);
    }

    @Test
    @DisplayName("PATCH run still rejects an unknown status")
    void updateRunStillRejectsUnknownStatus() {
        stubRun();
        assertThatThrownBy(() -> service.updateRun(RUN_ID, patchDto("definitely_not_a_status")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid migration execution run status");
    }
}
