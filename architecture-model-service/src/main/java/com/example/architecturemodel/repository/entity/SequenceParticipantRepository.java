package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SequenceParticipantEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SequenceParticipantRepository extends JpaRepository<SequenceParticipantEntity, String> {

    List<SequenceParticipantEntity> findBySequenceDiagramId(String sequenceDiagramId);

    void deleteBySequenceDiagramId(String sequenceDiagramId);
}
