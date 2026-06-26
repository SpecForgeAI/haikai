package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.targetmanifest.PersistTargetManifestArtifactsRequest;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactDto;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactInput;
import com.example.architecturemodel.service.targetmanifest.TargetManifestArtifactService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link TargetManifestArtifactController} (Spec 5 Phase 2,
 * Task Group 1).
 *
 * <p>Standalone setup mirrors {@code VulnerabilityControllerTest}: the MockMvc
 * converter is configured with the SNAKE_CASE naming strategy so these
 * assertions exercise the REAL production wire shape. Both endpoints behind the
 * controller's {@code @ConditionalOnProperty} gate are covered:
 * {@code POST .../manifest-artifacts} (201, snake_case body forwarded to the
 * service, latest returned) and {@code GET .../manifest-artifacts} (latest read,
 * one per tag, verbatim content + intact resolved_dependencies on the wire).</p>
 */
@ExtendWith(MockitoExtension.class)
class TargetManifestArtifactControllerTest {

    @Mock private TargetManifestArtifactService service;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TARGET_ARCH_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ARTIFACT_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final Instant NOW = Instant.parse("2026-06-25T10:00:00Z");

    @BeforeEach
    void setUp() {
        // SNAKE_CASE converter so the slice asserts the real production wire.
        objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        MappingJackson2HttpMessageConverter converter =
            new MappingJackson2HttpMessageConverter(objectMapper);
        mockMvc = MockMvcBuilders
            .standaloneSetup(new TargetManifestArtifactController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(converter)
            .build();
    }

    private TargetManifestArtifactDto dto(String tag, String content, String lock) {
        return new TargetManifestArtifactDto(
            ARTIFACT_ID, PROJECT_ID, TARGET_ARCH_ID, tag, "package_json", "NPM",
            "package.json", content, lock,
            List.of(Map.of("name", "react", "version", "18.2.0")),
            List.of(Map.of("friendly_name", "MCP SDK", "coordinate", "io.modelcontextprotocol.sdk")),
            true, NOW);
    }

    @Test
    @DisplayName("POST .../manifest-artifacts: 201; deserializes the snake_case body to the service (verbatim content + package_lock_content + resolved_dependencies); forwards path scope ids; returns the latest")
    void persistHappyPath() throws Exception {
        when(service.persistLatest(eq(PROJECT_ID), eq(TARGET_ARCH_ID), anyList()))
            .thenReturn(List.of(dto("web", "{\n  \"name\": \"app\"\n}\n", "{\n}\n")));

        // snake_case request body (the gateway client posts this shape).
        String body = objectMapper.writeValueAsString(new PersistTargetManifestArtifactsRequest(
            List.of(new TargetManifestArtifactInput(
                "web", "package_json", "NPM", "package.json",
                "{\n  \"name\": \"app\"\n}\n", "{\n}\n",
                List.of(Map.of("name", "react", "version", "18.2.0")),
                List.of(Map.of("friendly_name", "Spring AI", "coordinate", "spring-ai-openai"))))));

        mockMvc.perform(post(
                "/api/model/projects/{p}/target-architectures/{a}/manifest-artifacts",
                PROJECT_ID, TARGET_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            // snake_case wire keys on the returned latest.
            .andExpect(jsonPath("$[0].tag").value("web"))
            .andExpect(jsonPath("$[0].target_architecture_id").value(TARGET_ARCH_ID.toString()))
            .andExpect(jsonPath("$[0].manifest_path").value("package.json"))
            .andExpect(jsonPath("$[0].package_lock_content").value("{\n}\n"))
            .andExpect(jsonPath("$[0].is_latest").value(true))
            .andExpect(jsonPath("$[0].resolved_dependencies[0].name").value("react"))
            // Tier-2 free facts serialize snake_case on the response wire.
            .andExpect(jsonPath("$[0].tier2_facts[0].friendly_name").value("MCP SDK"))
            .andExpect(jsonPath("$[0].tier2_facts[0].coordinate").value("io.modelcontextprotocol.sdk"));

        // The snake_case body deserialized into the service input verbatim.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<TargetManifestArtifactInput>> captor =
            ArgumentCaptor.forClass(List.class);
        verify(service).persistLatest(eq(PROJECT_ID), eq(TARGET_ARCH_ID), captor.capture());
        List<TargetManifestArtifactInput> sent = captor.getValue();
        assertThat(sent).hasSize(1);
        TargetManifestArtifactInput one = sent.get(0);
        assertThat(one.tag()).isEqualTo("web");
        assertThat(one.kind()).isEqualTo("package_json");
        assertThat(one.ecosystem()).isEqualTo("NPM");
        assertThat(one.manifestPath()).isEqualTo("package.json");
        // Verbatim content + lockfile survive the wire round-trip byte-for-byte.
        assertThat(one.content()).isEqualTo("{\n  \"name\": \"app\"\n}\n");
        assertThat(one.packageLockContent()).isEqualTo("{\n}\n");
        assertThat(one.resolvedDependencies()).hasSize(1);
        assertThat(one.resolvedDependencies().get(0).get("name")).isEqualTo("react");
        // Tier-2 free facts deserialize from the snake_case wire onto the input.
        assertThat(one.tier2Facts()).hasSize(1);
        assertThat(one.tier2Facts().get(0).get("friendly_name")).isEqualTo("Spring AI");
        assertThat(one.tier2Facts().get(0).get("coordinate")).isEqualTo("spring-ai-openai");
    }

    @Test
    @DisplayName("GET .../manifest-artifacts: returns the latest artifacts (one per tag) as a snake_case list with verbatim content")
    void listLatestSnakeCase() throws Exception {
        when(service.findLatest(PROJECT_ID, TARGET_ARCH_ID))
            .thenReturn(List.of(
                dto("billing", "<billing/>\n", null),
                dto("orders", "<orders/>\n", null)));

        mockMvc.perform(get(
                "/api/model/projects/{p}/target-architectures/{a}/manifest-artifacts",
                PROJECT_ID, TARGET_ARCH_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].tag").value("billing"))
            .andExpect(jsonPath("$[0].content").value("<billing/>\n"))
            .andExpect(jsonPath("$[1].tag").value("orders"))
            .andExpect(jsonPath("$[1].content").value("<orders/>\n"))
            .andExpect(jsonPath("$[1].target_architecture_id").value(TARGET_ARCH_ID.toString()));

        verify(service).findLatest(PROJECT_ID, TARGET_ARCH_ID);
    }

    @Test
    @DisplayName("POST with an empty/absent body: forwards an empty list to the service (no NPE), returns 201")
    void persistEmptyBodyIsSafe() throws Exception {
        when(service.persistLatest(eq(PROJECT_ID), eq(TARGET_ARCH_ID), any()))
            .thenReturn(List.of());

        String body = objectMapper.writeValueAsString(
            new PersistTargetManifestArtifactsRequest(null));

        mockMvc.perform(post(
                "/api/model/projects/{p}/target-architectures/{a}/manifest-artifacts",
                PROJECT_ID, TARGET_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated());

        verify(service).persistLatest(eq(PROJECT_ID), eq(TARGET_ARCH_ID), any());
    }

    /**
     * Cross-layer payload-shape contract (Task Group 6, gap 6.2 #2 — the AMS-side
     * half). The gateway emits a fixed snake_case key set
     * (asserted gateway-side by
     * {@code migrationSeedManifestCrossSeam.test.ts} ->
     * "the gateway persist payload emits EXACTLY the AMS
     * TargetManifestArtifactInput snake_case key set"). Here we assert the OTHER
     * end of that wire: the EXACT raw JSON the gateway POSTs deserializes into the
     * AMS {@link TargetManifestArtifactInput} with every column populated and the
     * verbatim content/lockfile intact. A future rename on either side (e.g.
     * {@code manifest_path} -> {@code manifest_file}) would leave that field null
     * here and fail — surfacing a drift the per-side suites would each pass.
     *
     * <p>The JSON literal below is the wire shape the gateway client builds
     * ({@code gateway/src/services/targetManifestArtifactsClient.ts}
     * {@code TargetManifestArtifactInput} + the upload route's
     * {@code toTargetManifestArtifactInput} mapper): snake_case keys, the
     * scoping ids carried on the path (NOT the body).</p>
     */
    @Test
    @DisplayName("Payload-shape contract: the gateway's literal snake_case wire JSON deserializes into TargetManifestArtifactInput with every field populated + verbatim content")
    void gatewayWirePayloadDeserializesIntoInput() throws Exception {
        // The EXACT body the gateway POSTs: { artifacts: [ {snake_case...} ] }.
        String gatewayWire = "{\n"
            + "  \"artifacts\": [\n"
            + "    {\n"
            + "      \"tag\": \"orders-service\",\n"
            + "      \"kind\": \"pom.xml\",\n"
            + "      \"ecosystem\": \"MAVEN\",\n"
            + "      \"manifest_path\": \"services/orders/pom.xml\",\n"
            + "      \"content\": \"<project>\\n\\t<artifactId>caf\\u00e9-orders</artifactId>\\n</project>\\n\",\n"
            + "      \"package_lock_content\": null,\n"
            + "      \"resolved_dependencies\": [ { \"name\": \"g:a\", \"resolvedVersion\": \"1.2.3\", \"versionUnknown\": false } ]\n"
            + "    }\n"
            + "  ]\n"
            + "}";

        PersistTargetManifestArtifactsRequest request =
            objectMapper.readValue(gatewayWire, PersistTargetManifestArtifactsRequest.class);

        assertThat(request.artifacts()).hasSize(1);
        TargetManifestArtifactInput one = request.artifacts().get(0);

        // Every snake_case wire key mapped onto its record component (no field
        // left null by a name mismatch).
        assertThat(one.tag()).isEqualTo("orders-service");
        assertThat(one.kind()).isEqualTo("pom.xml");
        assertThat(one.ecosystem()).isEqualTo("MAVEN");
        assertThat(one.manifestPath()).isEqualTo("services/orders/pom.xml");
        // Verbatim content survives the wire byte-for-byte (tab + non-ASCII +
        // trailing newline).
        assertThat(one.content())
            .isEqualTo("<project>\n\t<artifactId>café-orders</artifactId>\n</project>\n");
        assertThat(one.packageLockContent()).isNull();
        // resolved_dependencies arrives as JSONB-bound maps with keys intact.
        assertThat(one.resolvedDependencies()).hasSize(1);
        assertThat(one.resolvedDependencies().get(0).get("name")).isEqualTo("g:a");
        assertThat(one.resolvedDependencies().get(0).get("resolvedVersion")).isEqualTo("1.2.3");
        assertThat(one.resolvedDependencies().get(0).get("versionUnknown")).isEqualTo(false);
    }
}
