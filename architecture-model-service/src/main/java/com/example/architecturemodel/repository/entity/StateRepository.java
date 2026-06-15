package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.StateEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface StateRepository extends JpaRepository<StateEntity, String> {

    List<StateEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
