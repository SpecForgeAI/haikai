package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.DataMovementEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DataMovementRepository extends JpaRepository<DataMovementEntity, String> {

    List<DataMovementEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
