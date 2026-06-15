package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SequenceFragmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SequenceFragmentRepository extends JpaRepository<SequenceFragmentEntity, String> {

    List<SequenceFragmentEntity> findBySequenceDiagramId(String sequenceDiagramId);

    void deleteBySequenceDiagramId(String sequenceDiagramId);
}
