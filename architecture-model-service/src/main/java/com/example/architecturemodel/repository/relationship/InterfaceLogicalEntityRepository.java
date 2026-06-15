package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.InterfaceLogicalEntityEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface InterfaceLogicalEntityRepository extends JpaRepository<InterfaceLogicalEntityEntity, String> {

    List<InterfaceLogicalEntityEntity> findByModelFileId(String modelFileId);

    List<InterfaceLogicalEntityEntity> findByInterfaceId(String interfaceId);

    void deleteByModelFileId(String modelFileId);
}
