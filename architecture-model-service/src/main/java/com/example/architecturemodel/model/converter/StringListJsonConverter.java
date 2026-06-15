package com.example.architecturemodel.model.converter;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.List;

/**
 * JPA AttributeConverter for converting List<String> to JSON String and back.
 *
 * Uses Jackson ObjectMapper for JSON serialization/deserialization.
 * This converter is NOT auto-applied; use @Convert annotation explicitly on fields.
 *
 * Null handling:
 * - convertToDatabaseColumn: null entity value returns null (not empty JSON)
 * - convertToEntityAttribute: null DB value returns empty ArrayList (not null)
 *
 * Spec 2026-01-31: Organisation Model + DB + API DTOs (Backend Foundation)
 */
@Converter
@Slf4j
public class StringListJsonConverter implements AttributeConverter<List<String>, String> {

    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final TypeReference<List<String>> LIST_TYPE_REF = new TypeReference<>() {};

    /**
     * Converts a List<String> entity attribute to a JSON String for database storage.
     *
     * @param attribute the entity attribute value to convert (may be null)
     * @return JSON string representation, or null if attribute is null
     */
    @Override
    public String convertToDatabaseColumn(List<String> attribute) {
        if (attribute == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(attribute);
        } catch (JsonProcessingException e) {
            log.error("Error converting List<String> to JSON: {}", e.getMessage(), e);
            throw new IllegalArgumentException("Failed to convert list to JSON", e);
        }
    }

    /**
     * Converts a JSON String from the database to a List<String> entity attribute.
     *
     * @param dbData the JSON string from the database (may be null or empty)
     * @return List<String> parsed from JSON, or empty ArrayList if dbData is null/empty
     */
    @Override
    public List<String> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(dbData, LIST_TYPE_REF);
        } catch (JsonProcessingException e) {
            log.error("Error converting JSON to List<String>: {}", e.getMessage(), e);
            throw new IllegalArgumentException("Failed to convert JSON to list", e);
        }
    }
}
