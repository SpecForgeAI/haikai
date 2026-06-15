package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SequenceNodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SequenceNodeRepository extends JpaRepository<SequenceNodeEntity, String> {

    List<SequenceNodeEntity> findBySequenceDiagramId(String sequenceDiagramId);

    List<SequenceNodeEntity> findBySequenceDiagramIdAndParentNodeId(String sequenceDiagramId, String parentNodeId);

    void deleteBySequenceDiagramId(String sequenceDiagramId);
}
