package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.discovery.DbRoutineEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Routine catalog reads (Stored Proc &amp; Function Behaviour Program, Spec 1). */
public interface DbRoutineRepository extends JpaRepository<DbRoutineEntity, UUID> {

    List<DbRoutineEntity> findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(UUID architectureId);

    List<DbRoutineEntity> findByArchitectureIdAndRoutineKindOrderBySchemaNameAscRoutineNameAsc(
        UUID architectureId, String routineKind);

    long countByArchitectureId(UUID architectureId);
}
