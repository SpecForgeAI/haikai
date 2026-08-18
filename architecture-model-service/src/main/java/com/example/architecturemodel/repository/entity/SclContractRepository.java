package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SclContractEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link SclContractEntity}.
 *
 * Provides the (scan_id, contract_key) upsert lookup, the kind / fan-in
 * scoped listings (backed by the {@code idx_scl_contract_scan_kind} and
 * {@code idx_scl_contract_scan_fan_in} indexes from changeset 224), a
 * substring search across the contract's identity-ish text columns, and the
 * per-scan corpus counts.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 */
@Repository
public interface SclContractRepository extends JpaRepository<SclContractEntity, UUID> {

    /**
     * The single contract for the (scan_id, contract_key) pair -- the upsert
     * key. Backed by the UNIQUE index {@code uq_scl_contract_scan_key}.
     *
     * @param scanId the owning scan UUID
     * @param contractKey the miner's stable per-scan contract key
     * @return the contract if present, empty Optional otherwise
     */
    Optional<SclContractEntity> findByScanIdAndContractKey(UUID scanId, String contractKey);

    /**
     * All contracts of one kind within a scan, ordered by contract key.
     *
     * @param scanId the owning scan UUID
     * @param kind the contract kind discriminator
     * @return matching contracts ordered by contractKey ascending
     */
    List<SclContractEntity> findByScanIdAndKindOrderByContractKeyAsc(UUID scanId, String kind);

    /**
     * The most load-bearing contracts first: every contract in a scan whose
     * fan-in is at least the given floor, highest fan-in first.
     *
     * @param scanId the owning scan UUID
     * @param minFanIn the inclusive fan-in floor
     * @return matching contracts ordered by fanIn descending
     */
    List<SclContractEntity> findByScanIdAndFanInGreaterThanEqualOrderByFanInDesc(
        UUID scanId, Integer minFanIn);

    /**
     * Every contract in a scan, ordered by contract key.
     *
     * @param scanId the owning scan UUID
     * @return the scan's contracts ordered by contractKey ascending
     */
    List<SclContractEntity> findByScanIdOrderByContractKeyAsc(UUID scanId);

    /**
     * Case-insensitive substring search over a scan's contracts, matching the
     * query against {@code contract_key} OR {@code source_symbol} OR
     * {@code source_path}. A single scan-scoped {@code @Query} is used instead
     * of the equivalent derived name
     * ({@code findByScanIdAndContractKeyContainingIgnoreCaseOr...}), which
     * repeats the scan-id predicate per OR-branch and is unreadable.
     *
     * @param scanId the owning scan UUID
     * @param q the raw substring to search for (caller-supplied, not a pattern)
     * @return matching contracts ordered by contractKey ascending
     */
    @Query("SELECT c FROM SclContractEntity c WHERE c.scanId = :scanId AND ("
        + "LOWER(c.contractKey) LIKE LOWER(CONCAT('%', :q, '%')) "
        + "OR LOWER(c.sourceSymbol) LIKE LOWER(CONCAT('%', :q, '%')) "
        + "OR LOWER(c.sourcePath) LIKE LOWER(CONCAT('%', :q, '%'))) "
        + "ORDER BY c.contractKey ASC")
    List<SclContractEntity> searchByScanIdAndQuery(
        @Param("scanId") UUID scanId, @Param("q") String q);

    /**
     * Total contracts in a scan (corpus-size stat).
     *
     * @param scanId the owning scan UUID
     * @return the contract count
     */
    long countByScanId(UUID scanId);

    /**
     * Contracts of one kind in a scan (per-kind breakdown stat).
     *
     * @param scanId the owning scan UUID
     * @param kind the contract kind discriminator
     * @return the matching contract count
     */
    long countByScanIdAndKind(UUID scanId, String kind);
}
