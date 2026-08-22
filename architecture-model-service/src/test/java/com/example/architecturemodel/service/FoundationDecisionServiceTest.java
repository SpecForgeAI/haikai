package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.FoundationDecisionDto;
import com.example.architecturemodel.model.entity.FoundationDecisionEntity;
import com.example.architecturemodel.repository.FoundationDecisionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Foundation-decision upsert semantics (Foundations Spec 1, 2026-08-22):
 * create on first answer, REVISE (same row) on re-answer with staleness
 * cleared, and loud validation for the required fields.
 */
@ExtendWith(MockitoExtension.class)
class FoundationDecisionServiceTest {

    @Mock
    private FoundationDecisionRepository repository;

    private FoundationDecisionDto dto(String key, String answer, Boolean stale) {
        return new FoundationDecisionDto(
            null, "p1", "a1", key, "backup_copy", "20 tables look like backups",
            answer, "excluded",
            List.of(Map.of("entity_name", "orders_bak")),
            null, "operator confirmed", "hash-1", stale, null, null, null);
    }

    @Test
    void firstAnswerCreatesTheDecisionRow() {
        when(repository.findByProjectIdAndArchitectureIdAndDecisionKey("p1", "a1", "F-1"))
            .thenReturn(Optional.empty());
        when(repository.save(any(FoundationDecisionEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        FoundationDecisionService service = new FoundationDecisionService(repository);
        List<FoundationDecisionDto> out =
            service.upsertAll("p1", "a1", List.of(dto("F-1", "exclude_all", null)));

        assertThat(out).hasSize(1);
        assertThat(out.get(0).decisionKey()).isEqualTo("F-1");
        assertThat(out.get(0).answer()).isEqualTo("exclude_all");
        assertThat(out.get(0).scope()).isEqualTo("excluded");
        assertThat(out.get(0).stale()).isFalse();
        assertThat(out.get(0).id()).isNotBlank();
    }

    @Test
    void reAnsweringRevisesTheSameRowAndClearsStaleness() {
        FoundationDecisionEntity existing = FoundationDecisionEntity.builder()
            .id("fd-1").projectId("p1").architectureId("a1").decisionKey("F-1")
            .ruleKey("backup_copy").answer("keep_all").stale(true)
            .createdAt(Instant.parse("2026-08-22T09:00:00Z"))
            .build();
        when(repository.findByProjectIdAndArchitectureIdAndDecisionKey("p1", "a1", "F-1"))
            .thenReturn(Optional.of(existing));
        when(repository.save(any(FoundationDecisionEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        FoundationDecisionService service = new FoundationDecisionService(repository);
        List<FoundationDecisionDto> out =
            service.upsertAll("p1", "a1", List.of(dto("F-1", "exclude_all", null)));

        assertThat(out.get(0).id()).isEqualTo("fd-1"); // same row, revised
        assertThat(out.get(0).answer()).isEqualTo("exclude_all");
        assertThat(out.get(0).stale()).isFalse(); // re-adjudication clears stale
    }

    @Test
    void missingKeyOrAnswerFailsLoud() {
        FoundationDecisionService service = new FoundationDecisionService(repository);
        assertThatThrownBy(() ->
            service.upsertAll("p1", "a1", List.of(dto(null, "exclude_all", null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("decision_key");
        assertThatThrownBy(() ->
            service.upsertAll("p1", "a1", List.of(dto("F-1", " ", null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("answer");
    }
}
