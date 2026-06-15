package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.BusinessUserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface BusinessUserRepository extends JpaRepository<BusinessUserEntity, String> {

    List<BusinessUserEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
