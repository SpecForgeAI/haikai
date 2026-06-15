package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.InterfaceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface InterfaceRepository extends JpaRepository<InterfaceEntity, String> {

    List<InterfaceEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
