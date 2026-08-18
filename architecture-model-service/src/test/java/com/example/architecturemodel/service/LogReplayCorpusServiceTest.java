package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.LogReplayCorpusCreateRequest;
import com.example.architecturemodel.model.dto.LogReplayCorpusDto;
import com.example.architecturemodel.model.entity.LogReplayCorpusEntity;
import com.example.architecturemodel.model.entity.LogReplayCorpusItemEntity;
import com.example.architecturemodel.repository.entity.LogReplayCorpusItemRepository;
import com.example.architecturemodel.repository.entity.LogReplayCorpusRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Mockito unit tests for {@link LogReplayCorpusService} (log-replay corpus,
 * Spec 5, 2026-08-18). Mirrors the {@link SclCorpusServiceTest} style.
 */
@ExtendWith(MockitoExtension.class)
class LogReplayCorpusServiceTest {

    @Mock
    private LogReplayCorpusRepository corpusRepository;

    @Mock
    private LogReplayCorpusItemRepository itemRepository;

    @InjectMocks
    private LogReplayCorpusService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();

    private LogReplayCorpusCreateRequest.Item item(String method, String path, String richness) {
        return new LogReplayCorpusCreateRequest.Item(
            method, "/pets/{id}", path,
            Map.of("body", Map.of("name", "nemo")), 201, 3, richness, null,
            "app.log", 12);
    }

    @Test
    @DisplayName("create persists the corpus + every item atomically with service-assigned ids")
    void createPersistsCorpusAndItems() {
        when(corpusRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(itemRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(itemRepository.countByCorpusId(any())).thenReturn(2L);

        LogReplayCorpusDto dto = service.create(PROJECT_ID, ARCHITECTURE_ID,
            new LogReplayCorpusCreateRequest(
                "app.log",
                Map.of("lines_total", 100),
                List.of(
                    item("post", "/pets/42", "with_body"),
                    item("GET", "/pets/42?depth=2", "url_only"))));

        assertThat(dto.projectId()).isEqualTo(PROJECT_ID);
        assertThat(dto.status()).isEqualTo("staged");
        assertThat(dto.itemCount()).isEqualTo(2L);

        ArgumentCaptor<LogReplayCorpusItemEntity> captor =
            ArgumentCaptor.forClass(LogReplayCorpusItemEntity.class);
        verify(itemRepository, org.mockito.Mockito.times(2)).save(captor.capture());
        // Methods are normalised to uppercase; occurrence counts carried.
        assertThat(captor.getAllValues().get(0).getMethod()).isEqualTo("POST");
        assertThat(captor.getAllValues().get(0).getOccurrenceCount()).isEqualTo(3);
        assertThat(captor.getAllValues().get(0).getId()).isNotNull();
    }

    @Test
    @DisplayName("create rejects an EMPTY item set — an empty extraction is never persisted")
    void createRejectsEmptyItems() {
        assertThatThrownBy(() -> service.create(PROJECT_ID, ARCHITECTURE_ID,
            new LogReplayCorpusCreateRequest("app.log", Map.of(), List.of())))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("at least one item");
        verify(corpusRepository, never()).save(any());
    }

    @Test
    @DisplayName("create rejects an unknown richness value")
    void createRejectsBadRichness() {
        when(corpusRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        assertThatThrownBy(() -> service.create(PROJECT_ID, ARCHITECTURE_ID,
            new LogReplayCorpusCreateRequest("app.log", Map.of(),
                List.of(item("GET", "/pets/1", "who_knows")))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("richness");
    }

    @Test
    @DisplayName("items 404s for an unknown corpus id (fail-closed read)")
    void itemsUnknownCorpus() {
        when(corpusRepository.findById(any())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.items(UUID.randomUUID()))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("patchStatus advances the status and 404s for unknown ids")
    void patchStatus() {
        LogReplayCorpusEntity corpus = LogReplayCorpusEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .architectureId(ARCHITECTURE_ID)
            .status("staged")
            .build();
        when(corpusRepository.findById(corpus.getId())).thenReturn(Optional.of(corpus));
        when(corpusRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(itemRepository.countByCorpusId(any())).thenReturn(0L);

        LogReplayCorpusDto dto = service.patchStatus(corpus.getId(), "replayed");
        assertThat(dto.status()).isEqualTo("replayed");

        when(corpusRepository.findById(any())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.patchStatus(UUID.randomUUID(), "x"))
            .isInstanceOf(ResourceNotFoundException.class);
    }
}
