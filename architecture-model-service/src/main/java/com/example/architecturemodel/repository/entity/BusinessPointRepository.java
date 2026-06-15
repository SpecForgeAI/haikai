package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.BusinessPointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface BusinessPointRepository extends JpaRepository<BusinessPointEntity, String> {

    List<BusinessPointEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
