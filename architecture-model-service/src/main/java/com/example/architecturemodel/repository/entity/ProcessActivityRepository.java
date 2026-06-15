package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ProcessActivityEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProcessActivityRepository extends JpaRepository<ProcessActivityEntity, String> {

    List<ProcessActivityEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
