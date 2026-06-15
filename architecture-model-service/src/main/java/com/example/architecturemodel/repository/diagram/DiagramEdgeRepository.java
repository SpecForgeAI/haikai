package com.example.architecturemodel.repository.diagram;

import com.example.architecturemodel.model.entity.DiagramEdgeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DiagramEdgeRepository extends JpaRepository<DiagramEdgeEntity, String> {

    List<DiagramEdgeEntity> findByDiagramId(String diagramId);

    List<DiagramEdgeEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    void deleteByDiagramId(String diagramId);
}
