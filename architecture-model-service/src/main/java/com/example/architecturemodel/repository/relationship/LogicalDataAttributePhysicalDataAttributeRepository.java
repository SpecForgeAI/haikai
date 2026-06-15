package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.LogicalDataAttributePhysicalDataAttributeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LogicalDataAttributePhysicalDataAttributeRepository extends JpaRepository<LogicalDataAttributePhysicalDataAttributeEntity, String> {

    List<LogicalDataAttributePhysicalDataAttributeEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
