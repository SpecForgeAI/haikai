package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.UICharacteristicEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository for UI Characteristic entity.
 *
 * Spec: UI Characteristics
 */
@Repository
public interface UICharacteristicRepository extends JpaRepository<UICharacteristicEntity, String> {

    /**
     * Find all UI characteristics for a given model file.
     *
     * @param modelFileId the model file ID
     * @return list of UI characteristics
     */
    List<UICharacteristicEntity> findByModelFileId(String modelFileId);

    /**
     * Delete all UI characteristics for a given model file.
     *
     * @param modelFileId the model file ID
     */
    void deleteByModelFileId(String modelFileId);

    /**
     * Find all UI characteristics for a given application point (UI).
     *
     * @param uiId the application point ID
     * @return list of UI characteristics
     */
    List<UICharacteristicEntity> findByUiId(String uiId);
}
