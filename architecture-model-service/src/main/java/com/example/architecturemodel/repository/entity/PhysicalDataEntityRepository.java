package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PhysicalDataEntityRepository extends JpaRepository<PhysicalDataEntityEntity, String> {

    List<PhysicalDataEntityEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
