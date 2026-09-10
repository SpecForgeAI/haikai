package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTargetBuildEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationAttemptEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import com.example.architecturemodel.repository.entity.DbMigrationPackRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTargetBuildRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationAttemptRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationRepository;
import com.example.architecturemodel.service.DbMigrationPackWorkbenchService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc slice over {@link DbMigrationPackWorkbenchController} + the real
 * {@link DbMigrationPackWorkbenchService} (repositories mocked) -- Stored Proc
 * &amp; Function Behaviour Program, Spec 4 (changeset 231).
 *
 * <p>Pins the two facts the reviewer's attempt history depends on: attempts
 * come back in ATTEMPT ORDER (so the diff-vs-previous rendering is a straight
 * walk), and a re-post of an already-recorded attempt number is a 409 that
 * NEVER overwrites the stored evidence.</p>
 *
 * <p>The converter is pinned to SNAKE_CASE so the slice asserts the real
 * production wire (entities are returned verbatim -- there are no response
 * DTOs carrying explicit {@code @JsonProperty} names).</p>
 */
@ExtendWith(MockitoExtension.class)
class DbMigrationPackTranslationAttemptControllerTest {

    @Mock
    private DbMigrationPackRepository packRepository;
    @Mock
    private DbMigrationPackTranslationRepository translationRepository;
    @Mock
    private DbMigrationPackTranslationAttemptRepository attemptRepository;
    @Mock
    private DbMigrationPackTargetBuildRepository targetBuildRepository;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID PACK_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID TRANSLATION_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        MappingJackson2HttpMessageConverter converter =
            new MappingJackson2HttpMessageConverter(objectMapper);
        DbMigrationPackWorkbenchService service = new DbMigrationPackWorkbenchService(
            packRepository, translationRepository, attemptRepository, targetBuildRepository);
        mockMvc = MockMvcBuilders
            .standaloneSetup(new DbMigrationPackWorkbenchController(service))
            .setMessageConverters(converter)
            .build();
    }

    private void packAndTranslationExist() {
        when(packRepository.findById(PACK_ID)).thenReturn(Optional.of(
            DbMigrationPackEntity.builder().id(PACK_ID).projectId(PROJECT_ID).build()));
        when(translationRepository.findById(TRANSLATION_ID)).thenReturn(Optional.of(
            DbMigrationPackTranslationEntity.builder()
                .id(TRANSLATION_ID)
                .packId(PACK_ID)
                .translationKey("stored_procedure--ops.upd_ledger_roll")
                .kind(DbMigrationPackTranslationEntity.KIND_STORED_PROCEDURE)
                .build()));
    }

    private static DbMigrationPackTranslationAttemptEntity attempt(int no, String verdict) {
        return DbMigrationPackTranslationAttemptEntity.builder()
            .id(UUID.randomUUID())
            .packId(PACK_ID)
            .translationId(TRANSLATION_ID)
            .attemptNo(no)
            .verdict(verdict)
            .draftContent("CREATE FUNCTION ops.upd_ledger_roll() -- rung " + no)
            .createdAt(Instant.parse("2026-09-09T10:0" + no + ":00Z"))
            .build();
    }

    @Test
    @DisplayName("attempts list ascending by attempt_no, snake_case wire")
    void attemptsListAscending() throws Exception {
        packAndTranslationExist();
        when(attemptRepository.findByTranslationIdOrderByAttemptNoAsc(TRANSLATION_ID))
            .thenReturn(List.of(
                attempt(1, DbMigrationPackTranslationAttemptEntity.VERDICT_DIVERGENT),
                attempt(2, DbMigrationPackTranslationAttemptEntity.VERDICT_APPLY_FAILED),
                attempt(3, DbMigrationPackTranslationAttemptEntity.VERDICT_RECONCILED)));

        mockMvc.perform(get(
                "/api/projects/{p}/db-migration-packs/{pack}/translations/{t}/attempts",
                PROJECT_ID, PACK_ID, TRANSLATION_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].attempt_no").value(1))
            .andExpect(jsonPath("$[1].attempt_no").value(2))
            .andExpect(jsonPath("$[2].attempt_no").value(3))
            .andExpect(jsonPath("$[0].verdict").value("divergent"))
            .andExpect(jsonPath("$[2].verdict").value("reconciled"))
            .andExpect(jsonPath("$[2].translation_id").value(TRANSLATION_ID.toString()));
    }

    @Test
    @DisplayName("POST appends an attempt (201) with the evidence rung and guidance")
    void postAppendsAttempt() throws Exception {
        packAndTranslationExist();
        when(attemptRepository.findByTranslationIdAndAttemptNo(TRANSLATION_ID, 2))
            .thenReturn(Optional.empty());
        when(attemptRepository.save(any(DbMigrationPackTranslationAttemptEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        String body = objectMapper.writeValueAsString(Map.of(
            "attempt_no", 2,
            "draft_content", "CREATE FUNCTION ops.upd_ledger_roll() ...",
            "judge_verdict_json", Map.of("verdict", "equivalent", "confidence", 0.8),
            "apply_result_json", Map.of("ok", true),
            "verdict", "divergent",
            "evidence_rungs_json", Map.of("rung", "one", "scenarios", List.of("zero_rows")),
            "guidance_text", "keep the NULL branch"));

        mockMvc.perform(post(
                "/api/projects/{p}/db-migration-packs/{pack}/translations/{t}/attempts",
                PROJECT_ID, PACK_ID, TRANSLATION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.attempt_no").value(2))
            .andExpect(jsonPath("$.verdict").value("divergent"))
            .andExpect(jsonPath("$.guidance_text").value("keep the NULL branch"))
            .andExpect(jsonPath("$.evidence_rungs_json.rung").value("one"));

        ArgumentCaptor<DbMigrationPackTranslationAttemptEntity> captor =
            ArgumentCaptor.forClass(DbMigrationPackTranslationAttemptEntity.class);
        verify(attemptRepository).save(captor.capture());
        assertThat(captor.getValue().getPackId()).isEqualTo(PACK_ID);
        assertThat(captor.getValue().getTranslationId()).isEqualTo(TRANSLATION_ID);
        assertThat(captor.getValue().getApplyResultJson()).containsEntry("ok", true);
    }

    @Test
    @DisplayName("duplicate attempt_no is a 409 and never overwrites the recorded evidence")
    void duplicateAttemptNoIsConflict() throws Exception {
        packAndTranslationExist();
        when(attemptRepository.findByTranslationIdAndAttemptNo(TRANSLATION_ID, 2))
            .thenReturn(Optional.of(
                attempt(2, DbMigrationPackTranslationAttemptEntity.VERDICT_DIVERGENT)));

        String body = objectMapper.writeValueAsString(Map.of(
            "attempt_no", 2,
            "verdict", "reconciled"));

        mockMvc.perform(post(
                "/api/projects/{p}/db-migration-packs/{pack}/translations/{t}/attempts",
                PROJECT_ID, PACK_ID, TRANSLATION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value(
                org.hamcrest.Matchers.containsString("already recorded")));

        verify(attemptRepository, never()).save(any());
    }

    @Test
    @DisplayName("target-builds/latest is 404 before the first build and the build row afterwards")
    void targetBuildLatest() throws Exception {
        when(packRepository.findById(PACK_ID)).thenReturn(Optional.of(
            DbMigrationPackEntity.builder().id(PACK_ID).projectId(PROJECT_ID).build()));
        when(targetBuildRepository.findFirstByPackIdOrderByStartedAtDesc(PACK_ID))
            .thenReturn(Optional.empty())
            .thenReturn(Optional.of(DbMigrationPackTargetBuildEntity.builder()
                .id(UUID.randomUUID())
                .packId(PACK_ID)
                .projectId(PROJECT_ID)
                .architectureId(UUID.randomUUID())
                .status(DbMigrationPackTargetBuildEntity.STATUS_SUCCEEDED)
                .phasesJson(Map.of("schema", Map.of("status", "succeeded")))
                .packVersion("v3")
                .rebuild(true)
                .startedAt(Instant.parse("2026-09-09T09:00:00Z"))
                .createdAt(Instant.parse("2026-09-09T09:00:00Z"))
                .build()));

        mockMvc.perform(get("/api/projects/{p}/db-migration-packs/{pack}/target-builds/latest",
                PROJECT_ID, PACK_ID))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/projects/{p}/db-migration-packs/{pack}/target-builds/latest",
                PROJECT_ID, PACK_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("succeeded"))
            .andExpect(jsonPath("$.pack_version").value("v3"))
            .andExpect(jsonPath("$.rebuild").value(true))
            .andExpect(jsonPath("$.phases_json.schema.status").value("succeeded"));
    }
}
