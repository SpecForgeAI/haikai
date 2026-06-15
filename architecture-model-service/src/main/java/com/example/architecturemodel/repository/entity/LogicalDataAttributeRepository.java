package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.LogicalDataAttributeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LogicalDataAttributeRepository extends JpaRepository<LogicalDataAttributeEntity, String> {

    List<LogicalDataAttributeEntity> findByModelFileId(String modelFileId);

    List<LogicalDataAttributeEntity> findByLogicalEntityId(String logicalEntityId);

    void deleteByModelFileId(String modelFileId);
}
