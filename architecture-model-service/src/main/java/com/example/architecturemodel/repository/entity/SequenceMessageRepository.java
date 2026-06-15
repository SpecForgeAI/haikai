package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SequenceMessageEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SequenceMessageRepository extends JpaRepository<SequenceMessageEntity, String> {

    List<SequenceMessageEntity> findBySequenceDiagramId(String sequenceDiagramId);

    void deleteBySequenceDiagramId(String sequenceDiagramId);
}
