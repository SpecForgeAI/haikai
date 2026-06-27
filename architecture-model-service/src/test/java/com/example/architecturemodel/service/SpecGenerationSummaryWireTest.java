package com.example.architecturemodel.service;

import com.example.architecturemodel.service.MigrationStorySpecGenerationService.SpecGenerationSummary;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Wire-format regression test for {@link SpecGenerationSummary}.
 *
 * <p>The spec-generation summary endpoint
 * ({@code GET .../migration-books-of-work/{bookId}/spec-generation-summary})
 * returns this record directly. Its ONLY consumer is the frontend summary
 * header (`frontend/src/api/specGenerationApi.ts` {@code SpecGenerationSummaryDto}),
 * which reads camelCase keys and casts {@code res.json()} with NO key coercion.
 *
 * <p>The record is therefore marked {@code @CamelCaseWire}. Without it, the AMS
 * global {@code SNAKE_CASE} naming strategy (see {@code application.yml}) emits
 * {@code saved_story_count} / {@code total_stories} / {@code next_batch_size},
 * every field deserialises to {@code undefined} on the client, and the header
 * renders blank counts + "no remaining stories" even when stories ARE saved.
 *
 * <p>Like {@code CamelCaseWireTest}, this uses a hand-built SNAKE_CASE-global
 * {@link ObjectMapper} mirroring the production config -- a default
 * (already-camelCase) mapper would NOT catch this regression.
 */
class SpecGenerationSummaryWireTest {

    /** Mirrors the production AMS ObjectMapper: global SNAKE_CASE naming. */
    private ObjectMapper snakeCaseGlobalMapper() {
        return new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    @Test
    @DisplayName("SpecGenerationSummary serialises camelCase keys even under the global SNAKE_CASE mapper")
    void serialisesCamelCaseUnderSnakeCaseGlobal() throws Exception {
        SpecGenerationSummary summary = new SpecGenerationSummary(
            6, 6, 0, 0, 0, 0, 0, 0, 6, 0, 6);

        String json = snakeCaseGlobalMapper().writeValueAsString(summary);

        assertThat(json)
            .as("must emit the camelCase keys the frontend SpecGenerationSummaryDto reads")
            .contains("\"savedStoryCount\"")
            .contains("\"totalStories\"")
            .contains("\"attemptedCount\"")
            .contains("\"nextBatchStart\"")
            .contains("\"nextBatchSize\"");
        assertThat(json)
            .as("must NOT fall back to the AMS global snake_case default")
            .doesNotContain("saved_story_count")
            .doesNotContain("total_stories")
            .doesNotContain("next_batch_size");
    }

    @Test
    @DisplayName("Frontend camelCase payload binds back to the record under the SNAKE_CASE mapper")
    void deserialisesCamelCaseUnderSnakeCaseGlobal() throws Exception {
        String camelJson = "{\"totalStories\":6,\"savedStoryCount\":6,\"attemptedCount\":0,"
            + "\"generatedCount\":0,\"generatedWithWarningsCount\":0,"
            + "\"insufficientContextCount\":0,\"failedCount\":0,\"skippedBlockedCount\":0,"
            + "\"notAttemptedCount\":0,\"nextBatchStart\":0,\"nextBatchSize\":6}";

        SpecGenerationSummary summary =
            snakeCaseGlobalMapper().readValue(camelJson, SpecGenerationSummary.class);

        assertThat(summary.savedStoryCount())
            .as("@CamelCaseWire must bind the camelCase key despite the global SNAKE_CASE default")
            .isEqualTo(6);
        assertThat(summary.nextBatchSize()).isEqualTo(6);
    }
}
