package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.UserJourneyEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UserJourneyRepository extends JpaRepository<UserJourneyEntity, String> {

    List<UserJourneyEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
