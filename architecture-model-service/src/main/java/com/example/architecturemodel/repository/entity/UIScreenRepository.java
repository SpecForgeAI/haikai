package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.UIScreenEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UIScreenRepository extends JpaRepository<UIScreenEntity, String> {

    List<UIScreenEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
