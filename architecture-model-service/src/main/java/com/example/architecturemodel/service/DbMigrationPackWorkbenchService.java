package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DbMigrationPackWorkbenchRequests.CreateTargetBuildRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackWorkbenchRequests.CreateTranslationAttemptRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackWorkbenchRequests.PatchTargetBuildRequest;
import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTargetBuildEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationAttemptEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import com.example.architecturemodel.repository.entity.DbMigrationPackRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTargetBuildRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationAttemptRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The translation workbench data plane -- Stored Proc &amp; Function Behaviour
 * Program, Spec 4 (changeset 231).
 *
 * <p>Two append/patch surfaces the gateway loop drives:</p>
 * <ol>
 *   <li><b>Attempt history</b> -- one row per loop iteration, APPEND-ONLY.
 *       {@code (translation_id, attempt_no)} is unique, so a re-post of an
 *       already-recorded attempt raises {@link IllegalStateException} (409 at
 *       the controller) rather than silently overwriting the evidence the
 *       reviewer is reading.</li>
 *   <li><b>Target builds</b> -- one row per build of the target database the
 *       loop applies drafts against. Opened {@code running} with empty phases;
 *       the chain PATCHes phases / status / S0 fingerprint / error SPARSELY,
 *       so a phase update can never wipe a recorded error.</li>
 * </ol>
 *
 * <p>AMS persists only -- ordering, the evidence ladder, the attempt cap and
 * the callee-first schedule all live in the gateway. Structured diagnostics
 * use the {@code [diag-ams] db_migration_pack_workbench} prefix.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DbMigrationPackWorkbenchService {

    private final DbMigrationPackRepository packRepository;
    private final DbMigrationPackTranslationRepository translationRepository;
    private final DbMigrationPackTranslationAttemptRepository attemptRepository;
    private final DbMigrationPackTargetBuildRepository targetBuildRepository;

    // -----------------------------------------------------------------
    // Attempt history
    // -----------------------------------------------------------------

    /**
     * Append one attempt to a translation's history.
     *
     * @throws ResourceNotFoundException unknown pack / translation (404)
     * @throws IllegalArgumentException missing body, missing or non-positive
     *     {@code attempt_no}, or an invalid {@code verdict} (400)
     * @throws IllegalStateException {@code attempt_no} already recorded (409)
     */
    @Transactional
    public DbMigrationPackTranslationAttemptEntity createAttempt(
        UUID projectId, UUID packId, UUID translationId,
        CreateTranslationAttemptRequest request) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        DbMigrationPackTranslationEntity translation =
            requireTranslation(pack.getId(), translationId);

        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.attemptNo() == null || request.attemptNo() < 1) {
            throw new IllegalArgumentException("attempt_no is required and must be >= 1");
        }
        if (request.verdict() == null) {
            throw new IllegalArgumentException(
                "verdict is required; allowed values: "
                    + DbMigrationPackTranslationAttemptEntity.ALL_VERDICTS);
        }
        validateValue("verdict", request.verdict(),
            DbMigrationPackTranslationAttemptEntity.ALL_VERDICTS);

        attemptRepository
            .findByTranslationIdAndAttemptNo(translation.getId(), request.attemptNo())
            .ifPresent(existing -> {
                throw new IllegalStateException(
                    "attempt_no " + request.attemptNo() + " already recorded for translation "
                        + translation.getId() + " (attempts are append-only)");
            });

        DbMigrationPackTranslationAttemptEntity saved = attemptRepository.save(
            DbMigrationPackTranslationAttemptEntity.builder()
                .id(UUID.randomUUID())
                .packId(pack.getId())
                .translationId(translation.getId())
                .attemptNo(request.attemptNo())
                .draftContent(request.draftContent())
                .judgeVerdictJson(request.judgeVerdictJson())
                .applyResultJson(request.applyResultJson())
                .parityReportId(request.parityReportId())
                .verdict(request.verdict())
                .evidenceRungsJson(request.evidenceRungsJson())
                .guidanceText(request.guidanceText())
                .createdAt(Instant.now())
                .build());

        log.info(
            "[diag-ams] db_migration_pack_workbench stage=attempt packId={} translationId={} "
                + "attemptNo={} verdict={}",
            pack.getId(), translation.getId(), saved.getAttemptNo(), saved.getVerdict());
        return saved;
    }

    /** One translation's attempts, oldest attempt first. */
    @Transactional(readOnly = true)
    public List<DbMigrationPackTranslationAttemptEntity> listAttempts(
        UUID projectId, UUID packId, UUID translationId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        DbMigrationPackTranslationEntity translation =
            requireTranslation(pack.getId(), translationId);
        return attemptRepository.findByTranslationIdOrderByAttemptNoAsc(translation.getId());
    }

    /**
     * Every attempt for a pack, ordered (translation, attempt_no) so the
     * Translations tab renders each row's history without re-sorting.
     */
    @Transactional(readOnly = true)
    public List<DbMigrationPackTranslationAttemptEntity> listPackAttempts(
        UUID projectId, UUID packId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        List<DbMigrationPackTranslationAttemptEntity> rows =
            new ArrayList<>(attemptRepository.findByPackId(pack.getId()));
        rows.sort(Comparator
            .comparing((DbMigrationPackTranslationAttemptEntity a) ->
                a.getTranslationId() == null ? "" : a.getTranslationId().toString())
            .thenComparing(a -> a.getAttemptNo() == null ? 0 : a.getAttemptNo()));
        return rows;
    }

    // -----------------------------------------------------------------
    // Target builds
    // -----------------------------------------------------------------

    /** Open a build row for the pack; starts {@code running} with empty phases. */
    @Transactional
    public DbMigrationPackTargetBuildEntity createTargetBuild(
        UUID projectId, UUID packId, CreateTargetBuildRequest request) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.projectId() == null || request.architectureId() == null) {
            throw new IllegalArgumentException("project_id and architecture_id are required");
        }

        Instant now = Instant.now();
        DbMigrationPackTargetBuildEntity saved = targetBuildRepository.save(
            DbMigrationPackTargetBuildEntity.builder()
                .id(UUID.randomUUID())
                .packId(pack.getId())
                .projectId(request.projectId())
                .architectureId(request.architectureId())
                .targetBindingJson(request.targetBindingJson())
                .status(DbMigrationPackTargetBuildEntity.STATUS_RUNNING)
                .packVersion(request.packVersion())
                .rebuild(Boolean.TRUE.equals(request.rebuild()))
                .startedAt(now)
                .createdAt(now)
                .build());

        log.info(
            "[diag-ams] db_migration_pack_workbench stage=target_build_open packId={} buildId={} "
                + "rebuild={}",
            pack.getId(), saved.getId(), saved.getRebuild());
        return saved;
    }

    /**
     * Sparse PATCH of a build row -- an omitted field leaves the column alone,
     * so a phase update never wipes a recorded error or the S0 fingerprint.
     *
     * @throws ResourceNotFoundException unknown pack / build (404)
     * @throws IllegalArgumentException invalid {@code status} (400)
     */
    @Transactional
    public DbMigrationPackTargetBuildEntity patchTargetBuild(
        UUID projectId, UUID packId, UUID buildId, PatchTargetBuildRequest patch) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (patch == null) {
            throw new IllegalArgumentException("request body is required");
        }
        DbMigrationPackTargetBuildEntity build = targetBuildRepository.findById(buildId)
            .filter(b -> pack.getId().equals(b.getPackId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "DB migration pack target build not found: " + buildId));

        if (patch.status() != null) {
            validateValue("status", patch.status(),
                DbMigrationPackTargetBuildEntity.ALL_STATUSES);
            build.setStatus(patch.status());
        }
        if (patch.phasesJson() != null) {
            build.setPhasesJson(patch.phasesJson());
        }
        if (patch.s0FingerprintJson() != null) {
            build.setS0FingerprintJson(patch.s0FingerprintJson());
        }
        if (patch.error() != null) {
            build.setError(patch.error().isBlank() ? null : patch.error());
        }
        if (patch.endedAt() != null) {
            build.setEndedAt(patch.endedAt());
        }

        DbMigrationPackTargetBuildEntity saved = targetBuildRepository.save(build);
        log.info(
            "[diag-ams] db_migration_pack_workbench stage=target_build_patch packId={} "
                + "buildId={} status={}",
            pack.getId(), saved.getId(), saved.getStatus());
        return saved;
    }

    /** A pack's builds, newest first. */
    @Transactional(readOnly = true)
    public List<DbMigrationPackTargetBuildEntity> listTargetBuilds(UUID projectId, UUID packId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        return targetBuildRepository.findByPackIdOrderByStartedAtDesc(pack.getId());
    }

    /** The latest build for a pack; empty = never built (the header's 404). */
    @Transactional(readOnly = true)
    public Optional<DbMigrationPackTargetBuildEntity> latestTargetBuild(
        UUID projectId, UUID packId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        return targetBuildRepository.findFirstByPackIdOrderByStartedAtDesc(pack.getId());
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    private DbMigrationPackEntity requirePack(UUID projectId, UUID packId) {
        if (projectId == null || packId == null) {
            throw new ResourceNotFoundException("DB migration pack not found: " + packId);
        }
        Optional<DbMigrationPackEntity> opt = packRepository.findById(packId);
        if (opt.isEmpty() || !projectId.equals(opt.get().getProjectId())) {
            throw new ResourceNotFoundException("DB migration pack not found: " + packId);
        }
        return opt.get();
    }

    private DbMigrationPackTranslationEntity requireTranslation(UUID packId, UUID translationId) {
        if (translationId == null) {
            throw new ResourceNotFoundException(
                "DB migration pack translation not found: " + null);
        }
        return translationRepository.findById(translationId)
            .filter(t -> packId.equals(t.getPackId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "DB migration pack translation not found: " + translationId));
    }

    private static void validateValue(String field, String value, Set<String> allowed) {
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException(
                "Invalid " + field + " '" + value + "'; allowed values: " + allowed);
        }
    }
}
