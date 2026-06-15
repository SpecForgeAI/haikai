package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.CodeUnitDependencyEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface CodeUnitDependencyRepository extends JpaRepository<CodeUnitDependencyEntity, String> {

    List<CodeUnitDependencyEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    /**
     * Find a code-unit-dependency edge by its identity composite
     * {@code (source_application_point_id, target_application_point_id,
     * declared_name, declared_version)} with NULL-tolerance on
     * {@code declared_version}.
     *
     * <p>Used by the discovery-service find-or-create flow (Spec:
     * 2026-05-06-library-discovery-integration). A Spring Data JPA derived
     * query would translate a null parameter into an {@code = NULL} predicate
     * which never matches existing NULL rows; the explicit JPQL query below
     * uses an {@code IS NULL OR =} predicate so a null input matches a NULL
     * stored value AND a non-null input matches the stored value.</p>
     *
     * @param sourceApplicationPointId the source AP id
     * @param targetApplicationPointId the target AP id
     * @param declaredName             the declared dependency name
     * @param declaredVersion          the declared version (may be null)
     * @return the matching edge, or empty if none.
     */
    @Query("SELECT e FROM CodeUnitDependencyEntity e "
        + "WHERE e.sourceApplicationPointId = :sourceApplicationPointId "
        + "  AND e.targetApplicationPointId = :targetApplicationPointId "
        + "  AND e.declaredName = :declaredName "
        + "  AND ((:declaredVersion IS NULL AND e.declaredVersion IS NULL) "
        + "       OR e.declaredVersion = :declaredVersion)")
    Optional<CodeUnitDependencyEntity> findOneBySourceTargetDeclared(
        @Param("sourceApplicationPointId") String sourceApplicationPointId,
        @Param("targetApplicationPointId") String targetApplicationPointId,
        @Param("declaredName") String declaredName,
        @Param("declaredVersion") String declaredVersion);
}
