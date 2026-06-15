package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.UIComponentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UIComponentRepository extends JpaRepository<UIComponentEntity, String> {

    List<UIComponentEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
