package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.UserJourneyLinkEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UserJourneyLinkRepository extends JpaRepository<UserJourneyLinkEntity, String> {

    List<UserJourneyLinkEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
