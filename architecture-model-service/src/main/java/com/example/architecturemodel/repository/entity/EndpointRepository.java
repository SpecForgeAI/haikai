package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.EndpointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface EndpointRepository extends JpaRepository<EndpointEntity, String> {

    List<EndpointEntity> findByModelFileId(String modelFileId);

    List<EndpointEntity> findByInterfaceId(String interfaceId);

    void deleteByModelFileId(String modelFileId);
}
