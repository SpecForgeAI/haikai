package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.AppBusinessPointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AppBusinessPointRepository extends JpaRepository<AppBusinessPointEntity, String> {

    List<AppBusinessPointEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
