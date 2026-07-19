package com.example.architecturemodel.service.security;

import com.example.architecturemodel.model.dto.security.CveEnrichmentRequest;
import com.example.architecturemodel.model.dto.security.CveRecordDto;
import com.example.architecturemodel.model.dto.security.CweRecordDto;
import com.example.architecturemodel.model.entity.security.CveEntity;
import com.example.architecturemodel.model.entity.security.CweEntity;
import com.example.architecturemodel.repository.security.CveRepository;
import com.example.architecturemodel.repository.security.CweRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * World-fact reference records: CVE / CWE stubs + enrichment (Security health
 * dashboard, 2026-07-19, Spec 1 of 3).
 *
 * <p><b>One-fact-one-home:</b> uploads never write world facts. Ingestion calls
 * {@link #ensureCveStubs} / {@link #ensureCweStubs} to create
 * {@code pending} stubs for unseen identifiers; the gateway OSV bridge later
 * reads {@link #listPendingCves} and applies {@link #applyCveEnrichment}.
 * Every read surface works on stubs alone -- enrichment absence or failure
 * degrades gracefully, never blocks.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class SecurityReferenceService {

    private final CveRepository cveRepository;
    private final CweRepository cweRepository;

    /**
     * Upsert pending stubs for every CVE id not yet known. Existing records
     * (stub or enriched) are left untouched.
     *
     * @return the number of NEW stubs created
     */
    @Transactional
    public int ensureCveStubs(Collection<String> cveIds) {
        Set<String> wanted = normalizeIds(cveIds);
        if (wanted.isEmpty()) {
            return 0;
        }
        Set<String> existing = cveRepository.findByCveIdIn(wanted).stream()
            .map(CveEntity::getCveId)
            .collect(Collectors.toSet());
        List<CveEntity> stubs = new ArrayList<>();
        for (String id : wanted) {
            if (!existing.contains(id)) {
                stubs.add(CveEntity.builder()
                    .id(UUID.randomUUID())
                    .cveId(id)
                    .enrichmentStatus("pending")
                    .build());
            }
        }
        if (!stubs.isEmpty()) {
            cveRepository.saveAll(stubs);
            log.debug("Security reference: created {} pending CVE stubs", stubs.size());
        }
        return stubs.size();
    }

    /**
     * Upsert pending stubs for every CWE id not covered by the MITRE seed.
     *
     * @return the number of NEW stubs created
     */
    @Transactional
    public int ensureCweStubs(Collection<String> cweIds) {
        Set<String> wanted = normalizeIds(cweIds);
        if (wanted.isEmpty()) {
            return 0;
        }
        Set<String> existing = cweRepository.findByCweIdIn(wanted).stream()
            .map(CweEntity::getCweId)
            .collect(Collectors.toSet());
        List<CweEntity> stubs = new ArrayList<>();
        for (String id : wanted) {
            if (!existing.contains(id)) {
                stubs.add(CweEntity.builder()
                    .id(UUID.randomUUID())
                    .cweId(id)
                    .enrichmentStatus("pending")
                    .build());
            }
        }
        if (!stubs.isEmpty()) {
            cweRepository.saveAll(stubs);
            log.debug("Security reference: created {} pending CWE stubs "
                + "(outside the MITRE seed)", stubs.size());
        }
        return stubs.size();
    }

    /** The enrichment work queue: pending CVE stubs, oldest first. */
    @Transactional(readOnly = true)
    public List<CveRecordDto> listPendingCves(int limit) {
        int capped = Math.max(1, Math.min(limit, 500));
        return cveRepository
            .findByEnrichmentStatusOrderByCreatedAtAsc("pending", PageRequest.of(0, capped))
            .stream()
            .map(CveRecordDto::from)
            .toList();
    }

    @Transactional(readOnly = true)
    public CveRecordDto getCve(String cveId) {
        return cveRepository.findByCveId(normalizeId(cveId))
            .map(CveRecordDto::from)
            .orElse(null);
    }

    /**
     * Apply world facts onto one CVE record (gateway OSV bridge). Creates the
     * record if the stub doesn't exist yet (enrichment may race ingest). Null
     * payload fields leave the current value untouched -- partial enrichment
     * is fine.
     */
    @Transactional
    public CveRecordDto applyCveEnrichment(String cveId, CveEnrichmentRequest request) {
        String normalized = normalizeId(cveId);
        if (normalized == null) {
            throw new IllegalArgumentException("cve_id is required");
        }
        CveEntity entity = cveRepository.findByCveId(normalized)
            .orElseGet(() -> CveEntity.builder()
                .id(UUID.randomUUID())
                .cveId(normalized)
                .enrichmentStatus("pending")
                .build());
        if (request != null) {
            if (request.summary() != null) {
                entity.setSummary(request.summary());
            }
            if (request.description() != null) {
                entity.setDescription(request.description());
            }
            if (request.cvssVector() != null) {
                entity.setCvssVector(request.cvssVector());
            }
            if (request.cvssScore() != null) {
                entity.setCvssScore(request.cvssScore());
            }
            if (request.severityOfficial() != null) {
                entity.setSeverityOfficial(request.severityOfficial());
            }
            if (request.cweIds() != null) {
                entity.setCweIds(new ArrayList<>(request.cweIds()));
                // Official CWE links may name ids outside the seed -- stub them
                // so the register's CWE lookup stays total.
                ensureCweStubs(request.cweIds());
            }
            if (request.aliases() != null) {
                entity.setAliases(new ArrayList<>(request.aliases()));
            }
            if (request.referenceUrls() != null) {
                entity.setReferenceUrls(new ArrayList<>(request.referenceUrls()));
            }
            if (request.publishedAt() != null) {
                entity.setPublishedAt(request.publishedAt());
            }
            if (request.modifiedAt() != null) {
                entity.setModifiedAt(request.modifiedAt());
            }
            if (request.kevListed() != null) {
                entity.setKevListed(request.kevListed());
            }
            if (request.epssScore() != null) {
                entity.setEpssScore(request.epssScore());
            }
            entity.setSource(request.source() != null ? request.source() : "osv");
            entity.setEnrichmentStatus(
                request.enrichmentStatus() != null ? request.enrichmentStatus() : "enriched");
        }
        entity.setFetchedAt(Instant.now());
        CveEntity saved = cveRepository.save(entity);
        log.debug("Security reference: applied enrichment to {} (status={})",
            normalized, saved.getEnrichmentStatus());
        return CveRecordDto.from(saved);
    }

    /** Batch CWE lookup for the register / frontend tooltips. */
    @Transactional(readOnly = true)
    public List<CweRecordDto> listCwes(Collection<String> cweIds) {
        Set<String> wanted = normalizeIds(cweIds);
        if (wanted.isEmpty()) {
            return List.of();
        }
        return cweRepository.findByCweIdIn(wanted).stream()
            .map(CweRecordDto::from)
            .toList();
    }

    // ---------------------------------------------------------------------

    private static Set<String> normalizeIds(Collection<String> ids) {
        if (ids == null) {
            return new HashSet<>();
        }
        Set<String> out = new LinkedHashSet<>();
        for (String id : ids) {
            String n = normalizeId(id);
            if (n != null) {
                out.add(n);
            }
        }
        return out;
    }

    /** Uppercase-trim the identifier so {@code cve-2024-1} and {@code CVE-2024-1} collide. */
    private static String normalizeId(String id) {
        if (id == null) {
            return null;
        }
        String t = id.trim().toUpperCase();
        return t.isEmpty() ? null : t;
    }
}
