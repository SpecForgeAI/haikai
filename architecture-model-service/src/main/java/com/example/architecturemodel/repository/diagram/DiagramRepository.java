package com.example.architecturemodel.repository.diagram;

import com.example.architecturemodel.model.entity.DiagramEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DiagramRepository extends JpaRepository<DiagramEntity, String> {

    List<DiagramEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    /**
     * Find all diagrams of a specific type where typed_content_json is NULL.
     * Used by migration service to find diagrams that need their typed content populated.
     *
     * @param diagramType The diagram type to filter by (e.g., "Sequence")
     * @return List of diagrams needing migration
     */
    List<DiagramEntity> findByDiagramTypeAndTypedContentJsonIsNull(String diagramType);

    /**
     * Find all diagrams for a given model file filtered by diagram type.
     * Avoids loading all diagram types when only a specific type is needed
     * (e.g., USER_JOURNEY diagrams for link resolution).
     *
     * @param modelFileId the model file ID to scope the query
     * @param diagramType the diagram type to filter by (e.g., "USER_JOURNEY")
     * @return List of matching diagrams
     */
    List<DiagramEntity> findByModelFileIdAndDiagramType(String modelFileId, String diagramType);
}
