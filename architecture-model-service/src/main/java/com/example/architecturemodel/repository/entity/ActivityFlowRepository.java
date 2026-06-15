package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ActivityFlowEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ActivityFlowRepository extends JpaRepository<ActivityFlowEntity, String> {

    List<ActivityFlowEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    // Methods for delete prevention check
    boolean existsByFromActivityId(String fromActivityId);

    boolean existsByToActivityId(String toActivityId);
}
