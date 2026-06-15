package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ValidationException;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.entity.ApplicationPointDto;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Targeted test confirming that a refactored {@code IllegalArgumentException}
 * throw in {@link ModelService} now throws the structured
 * {@link ValidationException} carrying the right
 * {@code (entityType, code, field, entityId, entityName)} tuple.
 *
 * Spec: Step 4 of the save-validation improvement series (2026-05-08).
 *
 * Strategy: invoke the private validator
 * {@code ModelService#validateApplicationPointTargets} via reflection on a
 * ModelService instance built with all-null collaborators (the validator is
 * a pure function of its arguments, never reads service state).
 *
 * Mockito is not used -- the validator does not require any collaborator
 * stubs, and bringing up a full Spring context just to assert one throw
 * path would be overkill.
 */
class ModelServiceValidationExceptionTest {

    @Test
    @DisplayName("ApplicationPoint with null application_id triggers ValidationException with structured fields")
    void applicationPointMissingApplicationIdThrowsValidationException() throws Exception {
        ModelService modelService = constructModelServiceWithNullCollaborators();

        ApplicationPointDto missingAppId = new ApplicationPointDto(
                "ap-1",          // id
                "Login Screen",  // name
                "desc",          // description
                "UI",            // kind
                null,            // application_id (deliberately missing)
                null,            // application_component_id
                null,            // service_id
                null,            // interface_id
                null,            // target_type
                null,            // target_ref_id
                null,            // point_type
                null,            // tags
                null,            // valid_from
                null             // valid_to
        );

        MetaModelEntitiesDto entities = emptyEntities();

        assertThatThrownBy(() -> invokeValidator(modelService, List.of(missingAppId), entities))
                .isInstanceOf(InvocationTargetException.class)
                .hasCauseInstanceOf(ValidationException.class)
                .satisfies(thrown -> {
                    ValidationException ex = (ValidationException) thrown.getCause();
                    assertThat(ex.getEntityType()).isEqualTo("application_points");
                    assertThat(ex.getCode()).isEqualTo("application_id_required");
                    assertThat(ex.getField()).isEqualTo("application_id");
                    assertThat(ex.getEntityId()).isEqualTo("ap-1");
                    assertThat(ex.getEntityName()).isEqualTo("Login Screen");
                    assertThat(ex.getMessage()).contains("ApplicationPoint validation failed for id 'ap-1'");
                    assertThat(ex.getMessage()).contains("application_id is required");
                });
    }

    @Test
    @DisplayName("ApplicationPoint with mismatched target_type / target_ref_id triggers ValidationException")
    void applicationPointPairwiseMismatchThrowsValidationException() throws Exception {
        ModelService modelService = constructModelServiceWithNullCollaborators();

        ApplicationPointDto pairwiseMismatch = new ApplicationPointDto(
                "ap-2", "Other Point", null, "UI",
                "app-1",            // application_id (set, so first check passes)
                null, null, null,
                "SERVICE",          // target_type set
                null,               // target_ref_id missing (pairwise violation)
                null, null, null, null
        );

        MetaModelEntitiesDto entities = emptyEntities();

        assertThatThrownBy(() -> invokeValidator(modelService, List.of(pairwiseMismatch), entities))
                .isInstanceOf(InvocationTargetException.class)
                .hasCauseInstanceOf(ValidationException.class)
                .satisfies(thrown -> {
                    ValidationException ex = (ValidationException) thrown.getCause();
                    assertThat(ex.getEntityType()).isEqualTo("application_points");
                    assertThat(ex.getCode()).isEqualTo("target_pairwise");
                    assertThat(ex.getField()).isEqualTo("target_type");
                    assertThat(ex.getEntityId()).isEqualTo("ap-2");
                    assertThat(ex.getEntityName()).isEqualTo("Other Point");
                });
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /**
     * Constructs a {@link ModelService} via reflection, supplying {@code null}
     * for every collaborator. The validator under test reads only its method
     * parameters, so no collaborators are needed -- and we avoid maintaining
     * a long parameter list that drifts with each new repository the codebase
     * adds.
     */
    private static ModelService constructModelServiceWithNullCollaborators() throws Exception {
        // Lombok's @RequiredArgsConstructor generates exactly one public
        // constructor. We grab it generically rather than hard-coding the
        // 84-arg signature, so this test does not break when new
        // dependencies are added.
        Constructor<?>[] ctors = ModelService.class.getDeclaredConstructors();
        if (ctors.length != 1) {
            throw new IllegalStateException(
                    "Expected exactly one ModelService constructor, found " + ctors.length);
        }
        Constructor<?> ctor = ctors[0];
        ctor.setAccessible(true);
        Object[] args = new Object[ctor.getParameterCount()];
        // All defaults are null; no need to fill anything.
        return (ModelService) ctor.newInstance(args);
    }

    /**
     * Reflectively invokes the private {@code validateApplicationPointTargets}
     * validator. The {@link InvocationTargetException} wraps the validator's
     * thrown exception -- callers should match on {@code .getCause()}.
     */
    private static void invokeValidator(ModelService service,
                                        List<ApplicationPointDto> applicationPoints,
                                        MetaModelEntitiesDto entities) throws Exception {
        Method m = ModelService.class.getDeclaredMethod(
                "validateApplicationPointTargets", List.class, MetaModelEntitiesDto.class);
        m.setAccessible(true);
        m.invoke(service, applicationPoints, entities);
    }

    /**
     * MetaModelEntitiesDto with all entity lists empty. Built reflectively to
     * the record's actual parameter count so this test does not break when
     * new entity types are added to the record.
     */
    private static MetaModelEntitiesDto emptyEntities() throws Exception {
        Constructor<?>[] ctors = MetaModelEntitiesDto.class.getDeclaredConstructors();
        if (ctors.length != 1) {
            throw new IllegalStateException(
                    "Expected exactly one MetaModelEntitiesDto canonical constructor, found "
                            + ctors.length);
        }
        Constructor<?> ctor = ctors[0];
        Object[] args = new Object[ctor.getParameterCount()];
        for (int i = 0; i < args.length; i++) {
            args[i] = Collections.emptyList();
        }
        return (MetaModelEntitiesDto) ctor.newInstance(args);
    }
}
