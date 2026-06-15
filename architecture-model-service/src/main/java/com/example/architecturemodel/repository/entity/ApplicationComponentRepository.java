package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ApplicationComponentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ApplicationComponentRepository extends JpaRepository<ApplicationComponentEntity, String> {

    List<ApplicationComponentEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
