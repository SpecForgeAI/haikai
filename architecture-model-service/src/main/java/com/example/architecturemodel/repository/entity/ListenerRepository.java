package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ListenerEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for ListenerEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface ListenerRepository extends JpaRepository<ListenerEntity, String> {

    List<ListenerEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
