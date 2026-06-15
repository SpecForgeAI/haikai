package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.MethodEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface MethodRepository extends JpaRepository<MethodEntity, String> {

    List<MethodEntity> findByModelFileId(String modelFileId);

    List<MethodEntity> findByClassId(String classId);

    void deleteByModelFileId(String modelFileId);

    void deleteByClassId(String classId);
}
