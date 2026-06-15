package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ActivityEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ActivityRepository extends JpaRepository<ActivityEntity, String> {

    List<ActivityEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
