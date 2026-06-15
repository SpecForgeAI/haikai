package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.StateTransitionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface StateTransitionRepository extends JpaRepository<StateTransitionEntity, String> {

    List<StateTransitionEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    // Methods for delete prevention check
    boolean existsByFromStateId(String fromStateId);

    boolean existsByToStateId(String toStateId);
}
