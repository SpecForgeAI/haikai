package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ActivityStepEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ActivityStepRepository extends JpaRepository<ActivityStepEntity, String> {

    List<ActivityStepEntity> findByModelFileId(String modelFileId);

    List<ActivityStepEntity> findByUserJourneyId(String userJourneyId);

    void deleteByModelFileId(String modelFileId);
}
