package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.UIContractEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UIContractRepository extends JpaRepository<UIContractEntity, String> {

    List<UIContractEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
