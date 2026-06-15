package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Reflection-based helpers to build empty record fixtures whose component
 * counts may evolve over time. Avoids coupling test code to the exact list
 * count of {@link MetaModelEntitiesDto} / {@link MetaModelRelationshipsDto}
 * and to the positional argument order of every entity / relationship DTO.
 */
final class TerraformTestFixtures {

    private TerraformTestFixtures() {}

    static MetaModelEntitiesDto emptyEntities() {
        return buildEmptyRecord(MetaModelEntitiesDto.class);
    }

    static MetaModelRelationshipsDto emptyRelationships() {
        return buildEmptyRecord(MetaModelRelationshipsDto.class);
    }

    /**
     * Build a record DTO with all components defaulted to null (or empty list
     * for List components), then override specific components by their
     * {@code @JsonProperty} JSON name. Keeps tests resilient to evolving DTOs.
     */
    @SuppressWarnings("unchecked")
    static <T> T buildRecord(Class<T> recordClass, Map<String, Object> overridesByJsonName) {
        try {
            RecordComponent[] components = recordClass.getRecordComponents();
            Class<?>[] paramTypes = new Class<?>[components.length];
            Object[] args = new Object[components.length];
            // Look up the canonical constructor first to get parameter annotations
            // (the @JsonProperty on record components propagates to the canonical
            // constructor parameters in modern javac, which is the most reliable
            // location to query at runtime).
            for (int i = 0; i < components.length; i++) {
                paramTypes[i] = components[i].getType();
            }
            Constructor<T> ctor = recordClass.getDeclaredConstructor(paramTypes);
            ctor.setAccessible(true);
            Parameter[] params = ctor.getParameters();
            for (int i = 0; i < components.length; i++) {
                String jsonName = jsonNameFor(components[i], params[i]);
                if (overridesByJsonName != null && overridesByJsonName.containsKey(jsonName)) {
                    args[i] = overridesByJsonName.get(jsonName);
                } else if (paramTypes[i] == List.class) {
                    args[i] = new ArrayList<>();
                } else {
                    args[i] = null;
                }
            }
            return ctor.newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException("Failed to build " + recordClass.getSimpleName(), e);
        }
    }

    static <T> T buildRecord(Class<T> recordClass) {
        return buildRecord(recordClass, Map.of());
    }

    /**
     * Resolve the JSON property name for a record component. {@code @JsonProperty}
     * targets {@code FIELD, METHOD, PARAMETER, ANNOTATION_TYPE} but not
     * {@code RECORD_COMPONENT}, so the annotation may not be visible via
     * {@link RecordComponent#getAnnotation}. Fall back to the accessor method
     * and the canonical-constructor parameter, finally to the component name.
     */
    private static String jsonNameFor(RecordComponent c, Parameter ctorParam) {
        JsonProperty ann = c.getAnnotation(JsonProperty.class);
        if (ann != null && !ann.value().isEmpty()) {
            return ann.value();
        }
        try {
            Method accessor = c.getAccessor();
            if (accessor != null) {
                JsonProperty a2 = accessor.getAnnotation(JsonProperty.class);
                if (a2 != null && !a2.value().isEmpty()) {
                    return a2.value();
                }
            }
        } catch (Exception ignored) {
            // ignore reflection failures
        }
        if (ctorParam != null) {
            JsonProperty a3 = ctorParam.getAnnotation(JsonProperty.class);
            if (a3 != null && !a3.value().isEmpty()) {
                return a3.value();
            }
        }
        return c.getName();
    }

    @SuppressWarnings("unchecked")
    private static <T> T buildEmptyRecord(Class<T> recordClass) {
        try {
            RecordComponent[] components = recordClass.getRecordComponents();
            Class<?>[] paramTypes = new Class<?>[components.length];
            Object[] args = new Object[components.length];
            for (int i = 0; i < components.length; i++) {
                paramTypes[i] = components[i].getType();
                if (paramTypes[i] == List.class) {
                    args[i] = new ArrayList<>();
                } else {
                    args[i] = null;
                }
            }
            Constructor<T> ctor = recordClass.getDeclaredConstructor(paramTypes);
            ctor.setAccessible(true);
            return ctor.newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException("Failed to build empty " + recordClass.getSimpleName(), e);
        }
    }

    /**
     * Rebuild a {@link MetaModelEntitiesDto} with one or more list components
     * replaced. Useful when an emitter test needs to inject a list of
     * Networks / InfrastructurePoints / etc. without enumerating every other
     * list field.
     */
    static MetaModelEntitiesDto entitiesWith(Map<String, Object> overridesByJsonName) {
        return buildRecord(MetaModelEntitiesDto.class, overridesByJsonName);
    }

    static MetaModelRelationshipsDto relationshipsWith(Map<String, Object> overridesByJsonName) {
        return buildRecord(MetaModelRelationshipsDto.class, overridesByJsonName);
    }
}
