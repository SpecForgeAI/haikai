package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.discovery.EndpointDataEffectDto;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.service.ModelService;
import com.example.architecturemodel.testsupport.TestMetaModelFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * endpoint_data_effects survive a model PUT whose body does not carry the key
 * (2026-09-03).
 *
 * <p>The model PUT is replace-all: {@code deleteAllDataForModelFile} deleted
 * every effect row for the model file and {@code saveRelationships} re-inserted
 * only when the incoming list was non-null. Any writer that PUT a model body
 * WITHOUT the {@code endpoint_data_effects} key therefore erased an
 * architecture's whole effect map silently. Now:</p>
 * <ul>
 *   <li>key ABSENT (null list) -&gt; existing rows are preserved;</li>
 *   <li>key PRESENT with an explicit empty list -&gt; rows are cleared;</li>
 *   <li>key PRESENT with rows -&gt; replace-all as before.</li>
 * </ul>
 */
@SpringBootTest
@Transactional
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:edepreservedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;NON_KEYWORDS=KEY"
})
class EndpointDataEffectsPreserveOnPutTest {

    @Autowired private ModelService modelService;
    @Autowired private ModelFileRepository modelFileRepository;
    @PersistenceContext private EntityManager entityManager;

    private String testFilename;

    @BeforeEach
    void setUp() {
        testFilename = "ede-preserve-it-" + UUID.randomUUID();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("mf-" + UUID.randomUUID())
            .filename(testFilename)
            .description("endpoint_data_effects preserve-on-PUT test model")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();
        modelFileRepository.save(modelFile);
        entityManager.flush();
    }

    @Test
    @DisplayName("a PUT whose body carries NO endpoint_data_effects key preserves the existing rows")
    void absentKeyPreservesRows() {
        modelService.saveModel(testFilename, modelWith(List.of(effect("ede-1"), effect("ede-2"))));
        assertThat(loadEffectIds()).containsExactlyInAnyOrder("ede-1", "ede-2");

        // A partial writer: relationships block present, effects key absent (null).
        modelService.saveModel(testFilename, modelWith(null));

        assertThat(loadEffectIds()).containsExactlyInAnyOrder("ede-1", "ede-2");
    }

    @Test
    @DisplayName("a PUT with an EXPLICIT empty list still clears the rows (absent != empty)")
    void explicitEmptyListClearsRows() {
        modelService.saveModel(testFilename, modelWith(List.of(effect("ede-1"))));
        assertThat(loadEffectIds()).containsExactly("ede-1");

        modelService.saveModel(testFilename, modelWith(List.of()));

        assertThat(loadEffectIds()).isEmpty();
    }

    @Test
    @DisplayName("a PUT carrying rows replaces the set as before")
    void rowsReplaceAsBefore() {
        modelService.saveModel(testFilename, modelWith(List.of(effect("ede-1"), effect("ede-2"))));
        modelService.saveModel(testFilename, modelWith(List.of(effect("ede-3"))));

        assertThat(loadEffectIds()).containsExactly("ede-3");
    }

    // ------------------------------------------------------------------------

    private List<String> loadEffectIds() {
        entityManager.flush();
        entityManager.clear();
        return modelService.loadModel(testFilename).metaModel().relationships().endpointDataEffects()
            .stream().map(EndpointDataEffectDto::id).toList();
    }

    private static EndpointDataEffectDto effect(String id) {
        return new EndpointDataEffectDto(
            id, "ep-1", "dep_phy_pde-1", "write",
            Map.of("derivation", "test"), 0.9, null, null, null, null);
    }

    /** Canonical 20-arg constructor so the LAST component (endpointDataEffects) can be null. */
    private static ArchitectureModelDto modelWith(List<EndpointDataEffectDto> effects) {
        MetaModelEntitiesDto entities = TestMetaModelFactory.emptyEntities();
        MetaModelRelationshipsDto rels = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(),
            effects
        );
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), List.of());
    }
}
