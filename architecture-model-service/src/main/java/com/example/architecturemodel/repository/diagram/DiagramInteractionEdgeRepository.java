package com.example.architecturemodel.repository.diagram;

import com.example.architecturemodel.model.entity.DiagramInteractionEdgeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DiagramInteractionEdgeRepository extends JpaRepository<DiagramInteractionEdgeEntity, String> {

    List<DiagramInteractionEdgeEntity> findByDiagramId(String diagramId);

    List<DiagramInteractionEdgeEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    void deleteByDiagramId(String diagramId);
}
