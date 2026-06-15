package com.example.architecturemodel.model.converter;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for StringListJsonConverter.
 *
 * Tests JSON serialization/deserialization for List<String> fields.
 *
 * Spec: Organisation Model + DB + API DTOs (Backend Foundation)
 * Task Group 2: JPA AttributeConverter for List<String> JSON Serialization
 */
class StringListJsonConverterTest {

    private StringListJsonConverter converter;

    @BeforeEach
    void setUp() {
        converter = new StringListJsonConverter();
    }

    /**
     * Test 1: convertToDatabaseColumn with valid List<String> returns JSON string.
     */
    @Test
    @DisplayName("convertToDatabaseColumn with valid List<String> returns JSON string")
    void testConvertToDatabaseColumnWithValidList() {
        List<String> input = List.of("doc1.md", "doc2.md", "doc3.md");

        String result = converter.convertToDatabaseColumn(input);

        assertThat(result).isNotNull();
        assertThat(result).isEqualTo("[\"doc1.md\",\"doc2.md\",\"doc3.md\"]");
    }

    /**
     * Test 2: convertToDatabaseColumn with null entity value returns null (not empty JSON).
     */
    @Test
    @DisplayName("convertToDatabaseColumn with null entity value returns null (not empty JSON)")
    void testConvertToDatabaseColumnWithNullReturnsNull() {
        String result = converter.convertToDatabaseColumn(null);

        assertThat(result).isNull();
    }

    /**
     * Test 3: convertToEntityAttribute with valid JSON returns List<String>.
     */
    @Test
    @DisplayName("convertToEntityAttribute with valid JSON returns List<String>")
    void testConvertToEntityAttributeWithValidJson() {
        String json = "[\"file1.txt\",\"file2.txt\"]";

        List<String> result = converter.convertToEntityAttribute(json);

        assertThat(result).isNotNull();
        assertThat(result).containsExactly("file1.txt", "file2.txt");
    }

    /**
     * Test 4: convertToEntityAttribute with null DB value returns empty ArrayList (not null).
     */
    @Test
    @DisplayName("convertToEntityAttribute with null DB value returns empty ArrayList (not null)")
    void testConvertToEntityAttributeWithNullReturnsEmptyList() {
        List<String> result = converter.convertToEntityAttribute(null);

        assertThat(result).isNotNull();
        assertThat(result).isEmpty();
        assertThat(result).isInstanceOf(ArrayList.class);
    }

    /**
     * Additional test: convertToEntityAttribute with empty string returns empty ArrayList.
     */
    @Test
    @DisplayName("convertToEntityAttribute with empty string returns empty ArrayList")
    void testConvertToEntityAttributeWithEmptyStringReturnsEmptyList() {
        List<String> result = converter.convertToEntityAttribute("");

        assertThat(result).isNotNull();
        assertThat(result).isEmpty();
    }

    /**
     * Additional test: convertToEntityAttribute with blank string returns empty ArrayList.
     */
    @Test
    @DisplayName("convertToEntityAttribute with blank string returns empty ArrayList")
    void testConvertToEntityAttributeWithBlankStringReturnsEmptyList() {
        List<String> result = converter.convertToEntityAttribute("   ");

        assertThat(result).isNotNull();
        assertThat(result).isEmpty();
    }

    /**
     * Additional test: convertToDatabaseColumn with empty list returns empty JSON array.
     */
    @Test
    @DisplayName("convertToDatabaseColumn with empty list returns empty JSON array")
    void testConvertToDatabaseColumnWithEmptyListReturnsEmptyArray() {
        List<String> input = new ArrayList<>();

        String result = converter.convertToDatabaseColumn(input);

        assertThat(result).isEqualTo("[]");
    }
}
