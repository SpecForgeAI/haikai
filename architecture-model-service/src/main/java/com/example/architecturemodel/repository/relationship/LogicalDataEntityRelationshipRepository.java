package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.LogicalDataEntityRelationshipEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LogicalDataEntityRelationshipRepository extends JpaRepository<LogicalDataEntityRelationshipEntity, String> {

    List<LogicalDataEntityRelationshipEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
