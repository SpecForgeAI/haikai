package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.BusinessUserBusinessPointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface BusinessUserBusinessPointRepository extends JpaRepository<BusinessUserBusinessPointEntity, String> {

    List<BusinessUserBusinessPointEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
