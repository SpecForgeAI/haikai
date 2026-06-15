package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.InteractionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface InteractionRepository extends JpaRepository<InteractionEntity, String> {

    List<InteractionEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
