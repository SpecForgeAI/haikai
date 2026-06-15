package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.BusinessLogicEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface BusinessLogicRepository extends JpaRepository<BusinessLogicEntity, String> {

    List<BusinessLogicEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
