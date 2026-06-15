package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SequenceOperandEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SequenceOperandRepository extends JpaRepository<SequenceOperandEntity, String> {

    List<SequenceOperandEntity> findByFragmentId(String fragmentId);

    void deleteByFragmentId(String fragmentId);
}
