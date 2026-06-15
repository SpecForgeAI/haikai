package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ClassEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ClassRepository extends JpaRepository<ClassEntity, String> {

    List<ClassEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
