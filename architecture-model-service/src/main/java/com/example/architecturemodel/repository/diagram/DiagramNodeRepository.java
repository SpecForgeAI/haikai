package com.example.architecturemodel.repository.diagram;

import com.example.architecturemodel.model.entity.DiagramNodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DiagramNodeRepository extends JpaRepository<DiagramNodeEntity, String> {

    List<DiagramNodeEntity> findByDiagramId(String diagramId);

    List<DiagramNodeEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    void deleteByDiagramId(String diagramId);
}
