package com.example.architecturemodel.jackson;

import com.fasterxml.jackson.annotation.JacksonAnnotationsInside;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marker meta-annotation identifying a DTO whose wire shape is
 * {@code lowerCamelCase}, overriding the Architecture Model Service's global
 * Jackson default of {@code SNAKE_CASE}.
 *
 * <h2>Why this exists</h2>
 *
 * <p>AMS speaks {@code snake_case} at the wire by default. The global is
 * configured in {@code architecture-model-service/src/main/resources/application.yml}
 * (and the matching test {@code application.yml}) via
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE}. The majority of
 * AMS endpoints' callers (gateway proxies, the discovery-service AMS client,
 * the api-migration-validation-service AMS client, and the frontend's
 * snake_case-typed API modules) explicitly depend on that wire format -- see
 * the consumer audit in
 * {@code agent-os/specs/2026-05-25-ams-dto-json-naming-audit-sweep/planning/requirements.md}
 * for the row-by-row evidence.</p>
 *
 * <p>A minority of newer endpoints -- the Selective Copy frontend, the
 * target-state architecture UI, and the captured-decisions data plane -- were
 * built against camelCase clients and therefore need their DTOs to serialise /
 * deserialise as camelCase regardless of the global default. Historically each
 * such DTO carried a raw
 * {@code @JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)}
 * with a multi-paragraph Javadoc explaining the override. This annotation
 * collapses that idiom to a single named marker: {@code @CamelCaseWire}.</p>
 *
 * <h2>Runtime behaviour</h2>
 *
 * <p>{@code @CamelCaseWire} is <strong>runtime-identical</strong> to
 * {@code @JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)}.
 * The annotation is itself meta-annotated with that exact {@code @JsonNaming}
 * declaration AND with {@code @JacksonAnnotationsInside} -- the latter is
 * <strong>load-bearing</strong>: without it Jackson does NOT recurse into a
 * custom annotation, so the nested {@code @JsonNaming} is silently ignored and
 * the DTO falls back to the global {@code SNAKE_CASE} (which is exactly the bug
 * this marker exists to prevent). With {@code @JacksonAnnotationsInside}
 * present, Jackson resolves the strategy through the meta-annotation chain and
 * there is no behaviour change versus the raw annotation it replaces;
 * the goal is purely to make the camelCase exception island legible to future
 * contributors who would otherwise have to grep for the raw Jackson incantation
 * to discover the pattern.</p>
 *
 * <h2>When to apply this annotation</h2>
 *
 * <p>Apply {@code @CamelCaseWire} on a new DTO (or controller / mapper that
 * declares an inline response type) when the DTO's consumer expects
 * lowerCamelCase JSON keys. The current application surface (as of the audit
 * that introduced this annotation) covers:</p>
 *
 * <ul>
 *   <li>The <strong>Selective Copy</strong> family of DTOs and requests --
 *       {@code SelectiveCopyPreflightRequest / Response},
 *       {@code SelectiveCopyCommitRequest / Response},
 *       {@code SuggestFromCurrentRequest / Response},
 *       {@code ArchitectureElementMappingDto}, and related create / update
 *       request DTOs.</li>
 *   <li>The <strong>target-state architecture</strong> surface --
 *       {@code ActiveTargetArchitectureController}'s response record,
 *       {@code TargetStateDecisionsSummaryDto}, and the apply-mapping-mutations
 *       request / response pair.</li>
 *   <li>The <strong>captured-decisions data plane</strong> --
 *       {@code TargetStateCapturedDecisionDto},
 *       {@code CreateTargetStateCapturedDecisionRequest},
 *       {@code CapturedDecisionRefDto}, and the two controllers and mapper
 *       wired to those DTOs.</li>
 * </ul>
 *
 * <p>If your new DTO's consumer speaks snake_case (the majority case in AMS),
 * do <strong>not</strong> apply this annotation -- the global default already
 * does the right thing.</p>
 *
 * <h2>Future hardening reference</h2>
 *
 * <p>The frontend module {@code frontend/src/api/epicCapturedDecisionsApi.ts}
 * implements a dual-tolerance {@code coerce(snake, camel)} pattern that lets
 * the client read both wire shapes. That is the idiom a future global-flip
 * migration would use to prepare consumers safely; it is out of scope for the
 * spec that introduced this annotation but named here so the next contributor
 * has a pointer. See
 * {@code agent-os/specs/2026-05-25-ams-dto-json-naming-audit-sweep/planning/requirements.md}
 * for the discussion.</p>
 *
 * @see com.fasterxml.jackson.databind.annotation.JsonNaming
 * @see com.fasterxml.jackson.databind.PropertyNamingStrategies.LowerCamelCaseStrategy
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@JacksonAnnotationsInside
@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)
public @interface CamelCaseWire {
}
