package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.PackageEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PackageRepository extends JpaRepository<PackageEntity, String> {

    List<PackageEntity> findByModelFileId(String modelFileId);

    List<PackageEntity> findByPackageSetId(String packageSetId);

    void deleteByModelFileId(String modelFileId);
}
