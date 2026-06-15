package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SequenceDiagramEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SequenceDiagramRepository extends JpaRepository<SequenceDiagramEntity, String> {

    List<SequenceDiagramEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
