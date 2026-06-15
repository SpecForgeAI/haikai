package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ActivityPartitionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ActivityPartitionRepository extends JpaRepository<ActivityPartitionEntity, String> {

    List<ActivityPartitionEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
