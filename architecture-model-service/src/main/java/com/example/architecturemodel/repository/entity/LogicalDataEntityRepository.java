package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LogicalDataEntityRepository extends JpaRepository<LogicalDataEntityEntity, String> {

    List<LogicalDataEntityEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
