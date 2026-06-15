package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.ApplicationPointBusinessPointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ApplicationPointBusinessPointRepository extends JpaRepository<ApplicationPointBusinessPointEntity, String> {

    List<ApplicationPointBusinessPointEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
