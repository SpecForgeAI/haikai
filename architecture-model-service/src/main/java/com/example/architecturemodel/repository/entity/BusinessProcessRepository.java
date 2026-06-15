package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.BusinessProcessEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface BusinessProcessRepository extends JpaRepository<BusinessProcessEntity, String> {

    List<BusinessProcessEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
