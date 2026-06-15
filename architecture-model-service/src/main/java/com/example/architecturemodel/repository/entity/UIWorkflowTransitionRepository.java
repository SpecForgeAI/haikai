package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.UIWorkflowTransitionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UIWorkflowTransitionRepository extends JpaRepository<UIWorkflowTransitionEntity, String> {

    List<UIWorkflowTransitionEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    // Methods for delete prevention check
    boolean existsBySourceScreenId(String sourceScreenId);

    boolean existsByTargetScreenId(String targetScreenId);
}
