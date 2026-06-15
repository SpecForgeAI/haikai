package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.EventEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface EventRepository extends JpaRepository<EventEntity, String> {

    List<EventEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
