package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.UIActionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UIActionRepository extends JpaRepository<UIActionEntity, String> {

    List<UIActionEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    List<UIActionEntity> findByOwnerScreenId(String ownerScreenId);

    List<UIActionEntity> findByOwnerComponentId(String ownerComponentId);
}
