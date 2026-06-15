package com.example.architecturemodel.exception;

import jakarta.validation.ConstraintViolation;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleResourceNotFoundException(ResourceNotFoundException ex) {
        log.warn("Resource not found: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.NOT_FOUND.value());
        body.put("error", "Not Found");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Map<String, Object>> handleConflictException(ConflictException ex) {
        log.warn("Conflict: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.CONFLICT.value());
        body.put("error", "Conflict");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }

    /**
     * Handles duplicate-architecture-name conflicts.
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * Returns 409 Conflict with envelope including {@code code} and
     * {@code field} so the frontend can render the message inline next to
     * the Name field on the Edit / Create modal.
     */
    @ExceptionHandler(DuplicateArchitectureNameException.class)
    public ResponseEntity<Map<String, Object>> handleDuplicateArchitectureNameException(
            DuplicateArchitectureNameException ex) {
        log.warn("Duplicate architecture name: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.CONFLICT.value());
        body.put("error", "Conflict");
        body.put("code", "duplicate_name");
        body.put("message", ex.getMessage());
        body.put("field", "name");

        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }

    /**
     * Handles attempts to archive the last non-archived architecture in a
     * project.
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * Returns 422 Unprocessable Entity with envelope including
     * {@code code: "last_architecture"} so the frontend can render the
     * specific protective message in the Archive confirmation modal.
     */
    @ExceptionHandler(LastArchitectureException.class)
    public ResponseEntity<Map<String, Object>> handleLastArchitectureException(
            LastArchitectureException ex) {
        log.warn("Cannot archive last architecture: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("code", "last_architecture");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    /**
     * Handles attempts to clone an archived source architecture.
     *
     * Spec: Multi-Architecture Full Clone (Spec #6)
     *
     * Returns 422 Unprocessable Entity with envelope including
     * {@code code: "archived_source"} so the Clone modal can surface the
     * message in its footer banner. The UI already filters archived rows
     * out of the Manage modal, so this is a defence-in-depth check.
     */
    @ExceptionHandler(ArchivedArchitectureSourceException.class)
    public ResponseEntity<Map<String, Object>> handleArchivedArchitectureSourceException(
            ArchivedArchitectureSourceException ex) {
        log.warn("Cannot clone archived source architecture: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("code", "archived_source");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    /**
     * Handles attempts to selectively copy from an architecture into itself.
     *
     * Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)
     *
     * Returns 422 Unprocessable Entity with envelope including
     * {@code code: "same_architecture"} so the wizard footer banner can
     * surface the specific message. The UI already disables the per-row
     * {@code Copy from...} button on the active architecture's row, so this
     * is a defence-in-depth check.
     */
    @ExceptionHandler(SameArchitectureCopyException.class)
    public ResponseEntity<Map<String, Object>> handleSameArchitectureCopyException(
            SameArchitectureCopyException ex) {
        log.warn("Cannot selectively copy into the same architecture: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("code", "same_architecture");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    /**
     * Handles attempts to commit a selective-copy with unresolved missing
     * references — typically when the user manually un-ticked an
     * auto-included element from the picker tree before submitting.
     *
     * Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)
     *
     * Returns 422 Unprocessable Entity with envelope including
     * {@code code: "missing_reference"} so the wizard footer banner can
     * surface the specific message and prompt the user to re-run preflight.
     */
    @ExceptionHandler(UnresolvedMissingReferenceException.class)
    public ResponseEntity<Map<String, Object>> handleUnresolvedMissingReferenceException(
            UnresolvedMissingReferenceException ex) {
        log.warn("Selective copy refused due to unresolved missing reference: {}",
            ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("code", "missing_reference");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    /**
     * Handles attempts to create a duplicate architecture-element mapping —
     * the unique constraint on (project, source/target arch, source/target
     * element identifiers, mapping_type) has rejected the row at the service
     * layer.
     *
     * Spec: Create Target Baseline from Current State (2026-05-15)
     *
     * Returns 422 Unprocessable Entity with envelope including
     * {@code code: "duplicate_mapping"} so the Mapping Review modal can
     * branch on the structured error code and surface an inline message.
     */
    @ExceptionHandler(DuplicateArchitectureElementMappingException.class)
    public ResponseEntity<Map<String, Object>> handleDuplicateArchitectureElementMappingException(
            DuplicateArchitectureElementMappingException ex) {
        log.warn("Duplicate architecture-element mapping rejected: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("code", "duplicate_mapping");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    /**
     * Handles illegal status transitions on a {@code discovery_findings} row,
     * thrown by {@code DiscoveryFindingService} when a caller attempts e.g.
     * {@code resolved -> new}.
     *
     * Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
     * (2026-05-16)
     *
     * Returns 422 Unprocessable Entity with envelope including
     * {@code code: "invalid_status_transition"} so the frontend findings
     * drawer can render an inline error toast with the from/to context.
     */
    @ExceptionHandler(InvalidFindingStatusTransitionException.class)
    public ResponseEntity<Map<String, Object>> handleInvalidFindingStatusTransitionException(
            InvalidFindingStatusTransitionException ex) {
        log.warn("Invalid finding status transition: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("code", "invalid_status_transition");
        body.put("from_status", ex.getFromStatus());
        body.put("to_status", ex.getToStatus());
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    /**
     * Handles D6 hard-reject for {@code discovery_finding_links} creation
     * when the target does not exist OR is out of scope (different run /
     * different architecture).
     *
     * Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
     * (2026-05-16)
     *
     * Returns 400 Bad Request with envelope including
     * {@code code: "invalid_link_target"} so callers can distinguish a
     * link-validation failure from generic 400s.
     */
    @ExceptionHandler(InvalidFindingLinkTargetException.class)
    public ResponseEntity<Map<String, Object>> handleInvalidFindingLinkTargetException(
            InvalidFindingLinkTargetException ex) {
        log.warn("Invalid finding link target: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("code", "invalid_link_target");
        body.put("target_type", ex.getTargetType());
        body.put("target_id", ex.getTargetId());
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    /**
     * Handles structured service-layer validation failures, replacing the
     * bare {@link IllegalArgumentException} previously thrown by
     * {@code ModelService} for entity / relationship validation rules.
     *
     * Spec: Step 4 of the save-validation improvement series (2026-05-08).
     *
     * Returns HTTP 400 with snake_case envelope including {@code entity_type},
     * {@code code}, {@code field}, {@code entity_id}, {@code entity_name},
     * {@code message}. The frontend uses {@code entity_type} + {@code code}
     * to route the error to the existing pre-save validation panel so a
     * backend-side rejection looks identical to a frontend-side one.
     */
    @ExceptionHandler(ValidationException.class)
    public ResponseEntity<Map<String, Object>> handleValidationException(ValidationException ex) {
        log.warn("Validation failure: entityType={}, code={}, field={}, entityId={}, message={}",
                ex.getEntityType(), ex.getCode(), ex.getField(), ex.getEntityId(), ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        if (ex.getEntityType() != null) {
            body.put("entity_type", ex.getEntityType());
        }
        if (ex.getCode() != null) {
            body.put("code", ex.getCode());
        }
        if (ex.getField() != null) {
            body.put("field", ex.getField());
        }
        if (ex.getEntityId() != null) {
            body.put("entity_id", ex.getEntityId());
        }
        if (ex.getEntityName() != null) {
            body.put("entity_name", ex.getEntityName());
        }
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgumentException(IllegalArgumentException ex) {
        log.warn("Bad request: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    /**
     * Handles unreadable / missing request bodies (malformed JSON, JSON literal
     * null where a body object is required, empty body on @RequestBody handlers).
     *
     * Without this handler the generic @ExceptionHandler(Exception.class)
     * catch-all below turned these CLIENT errors into 500s. A request the
     * client can fix must be a 400 (this regressed when the catch-all was
     * introduced; controller tests pin the 400 contract).
     */
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> handleHttpMessageNotReadableException(
            org.springframework.http.converter.HttpMessageNotReadableException ex) {
        log.warn("Unreadable request body: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("message", "Required request body is missing or malformed");

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    /**
     * Handles @Valid request-body validation failures (e.g. @NotBlank fields).
     *
     * Same regression family as HttpMessageNotReadableException above: without
     * this handler the generic catch-all turned bean-validation CLIENT errors
     * into 500s. Spring default behaviour (and the controller tests) expect 400.
     */
    @ExceptionHandler(org.springframework.web.bind.MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleMethodArgumentNotValidException(
            org.springframework.web.bind.MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .sorted()
                .reduce((a, b) -> a + "; " + b)
                .orElse("Validation failed");
        log.warn("Request body validation failed: {}", message);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("message", message);

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String, Object>> handleMissingServletRequestParameterException(
            MissingServletRequestParameterException ex) {
        log.warn("Missing request parameter: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    /**
     * Handles NoResourceFoundException for static resource requests that don't match any endpoint.
     *
     * Spec 2026-01-22: Session-Backed Active Project
     *
     * Returns HTTP 404 with standard JSON error response structure.
     *
     * @param ex The NoResourceFoundException
     * @return ResponseEntity with 404 status and error details
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNoResourceFoundException(NoResourceFoundException ex) {
        log.warn("Resource not found: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.NOT_FOUND.value());
        body.put("error", "Not Found");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
    }

    /**
     * Handles NoHandlerFoundException for requests that do not match any
     * registered controller route.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1) -- this is the path-segment
     * safety net. URLs missing the {architectureId} segment must 404, not
     * silently fall through. Without this explicit handler the request would
     * fall to the generic Exception handler and return 500.
     *
     * Returns HTTP 404 with the standard JSON error response structure.
     *
     * @param ex The NoHandlerFoundException
     * @return ResponseEntity with 404 status and error details
     */
    @ExceptionHandler(NoHandlerFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNoHandlerFoundException(NoHandlerFoundException ex) {
        log.warn("No handler found: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.NOT_FOUND.value());
        body.put("error", "Not Found");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatusException(ResponseStatusException ex) {
        HttpStatus status = HttpStatus.valueOf(ex.getStatusCode().value());
        log.warn("Response status exception: {} - {}", status, ex.getReason());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", status.value());
        body.put("error", status.getReasonPhrase());
        body.put("message", ex.getReason());

        return ResponseEntity.status(status).body(body);
    }

    // -------------------------------------------------------------------------
    // DB / Bean-Validation constraint handlers (Step 5 of save-validation series)
    // -------------------------------------------------------------------------

    /**
     * Pattern: Postgres NOT NULL violation message,
     * e.g. {@code null value in column "name" of relation "architectures" violates not-null constraint}.
     */
    private static final Pattern PG_NULL_PATTERN =
            Pattern.compile("null value in column \"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    /**
     * Pattern: H2 / SQLite NOT NULL message, e.g.
     * {@code NULL not allowed for column "NAME"} (H2)
     * or {@code NOT NULL constraint failed: architectures.name} (SQLite/H2 newer).
     */
    private static final Pattern H2_NULL_NOT_ALLOWED_PATTERN =
            Pattern.compile("NULL not allowed for column \"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    private static final Pattern SQLITE_H2_NULL_PATTERN =
            Pattern.compile("NOT NULL constraint failed:\\s*(?:[A-Za-z0-9_]+\\.)?([A-Za-z0-9_]+)",
                    Pattern.CASE_INSENSITIVE);

    /**
     * Pattern: Postgres FK violation. Column name is sometimes available
     * via {@code Key (col)=(val) is not present in table "..."}.
     */
    private static final Pattern PG_FK_KEY_PATTERN =
            Pattern.compile("Key \\(([^)]+)\\)=", Pattern.CASE_INSENSITIVE);

    private static final Pattern FK_VIOLATION_TEXT =
            Pattern.compile("violates foreign key constraint", Pattern.CASE_INSENSITIVE);

    /**
     * Pattern: Postgres unique violation key extraction
     * {@code Key (col)=(val) already exists}.
     */
    private static final Pattern PG_UNIQUE_KEY_PATTERN =
            Pattern.compile("Key \\(([^)]+)\\)=\\([^)]*\\) already exists", Pattern.CASE_INSENSITIVE);

    private static final Pattern PG_UNIQUE_TEXT =
            Pattern.compile("duplicate key value violates unique constraint", Pattern.CASE_INSENSITIVE);

    /**
     * Pattern: SQLite/H2 unique violation,
     * e.g. {@code UNIQUE constraint failed: architectures.name}.
     */
    private static final Pattern SQLITE_H2_UNIQUE_PATTERN =
            Pattern.compile("UNIQUE constraint failed:\\s*(?:[A-Za-z0-9_]+\\.)?([A-Za-z0-9_]+)",
                    Pattern.CASE_INSENSITIVE);

    /**
     * Handles Spring Data / JPA constraint failures bubbling up as
     * {@link DataIntegrityViolationException}. Walks the cause chain to
     * extract the most specific (column, constraint) detail available
     * across Postgres, H2, and SQLite drivers, then returns a structured
     * 400 with a discriminating {@code code} so the frontend can route
     * the message to the right field.
     *
     * Spec: Step 5 of the save-validation series — DB-layer rejections
     * that escape earlier validation should still surface to the user as
     * 400 Bad Request, not as opaque 500s.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> handleDataIntegrityViolationException(
            DataIntegrityViolationException ex) {
        log.warn("DB constraint violation: {}", ex.getMessage(), ex);

        String rootMessage = rootCauseMessage(ex);
        String code = "constraint_violation";
        String field = null;
        String message;

        // 1) NOT NULL — Postgres
        Matcher m = PG_NULL_PATTERN.matcher(rootMessage);
        if (m.find()) {
            code = "null_violation";
            field = m.group(1);
            message = "Required field '" + field + "' is missing.";
        } else if ((m = H2_NULL_NOT_ALLOWED_PATTERN.matcher(rootMessage)).find()) {
            // 1b) NOT NULL — H2 legacy ("NULL not allowed for column \"X\"")
            code = "null_violation";
            field = m.group(1);
            message = "Required field '" + field + "' is missing.";
        } else if ((m = SQLITE_H2_NULL_PATTERN.matcher(rootMessage)).find()) {
            // 1c) NOT NULL — SQLite / H2 modern ("NOT NULL constraint failed: T.X")
            code = "null_violation";
            field = m.group(1);
            message = "Required field '" + field + "' is missing.";
        } else if (FK_VIOLATION_TEXT.matcher(rootMessage).find()) {
            // 2) FK — Postgres / generic
            code = "foreign_key_violation";
            Matcher fk = PG_FK_KEY_PATTERN.matcher(rootMessage);
            if (fk.find()) {
                field = fk.group(1);
                message = "Referenced entity does not exist for field '" + field + "'.";
            } else {
                message = "Foreign key constraint violated.";
            }
        } else if (PG_UNIQUE_TEXT.matcher(rootMessage).find()) {
            // 3) UNIQUE — Postgres
            code = "unique_violation";
            Matcher uq = PG_UNIQUE_KEY_PATTERN.matcher(rootMessage);
            if (uq.find()) {
                field = uq.group(1);
                message = "Duplicate value for unique field '" + field + "'.";
            } else {
                message = "Duplicate value for unique field.";
            }
        } else if ((m = SQLITE_H2_UNIQUE_PATTERN.matcher(rootMessage)).find()) {
            // 3b) UNIQUE — SQLite / H2
            code = "unique_violation";
            field = m.group(1);
            message = "Duplicate value for unique field '" + field + "'.";
        } else {
            // 4) Fallback — generic constraint violation, surface root cause text.
            message = rootMessage;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("code", code);
        if (field != null) {
            body.put("field", field);
        }
        body.put("message", message);

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    /**
     * Handles Bean Validation (JSR-380) failures thrown via
     * {@code @Validated} method-parameter validation. Note: this handler
     * targets {@link jakarta.validation.ConstraintViolationException} —
     * NOT Hibernate's same-named DB-layer exception (which arrives wrapped
     * inside {@link DataIntegrityViolationException} above).
     *
     * Spec: Step 5 of the save-validation series. Defensive — fires only
     * if the codebase introduces {@code @Validated} method params later.
     */
    @ExceptionHandler(jakarta.validation.ConstraintViolationException.class)
    public ResponseEntity<Map<String, Object>> handleBeanValidationException(
            jakarta.validation.ConstraintViolationException ex) {
        log.warn("Bean validation violation: {}", ex.getMessage(), ex);

        String firstField = ex.getConstraintViolations().stream()
                .findFirst()
                .map(v -> v.getPropertyPath() == null ? null : v.getPropertyPath().toString())
                .orElse(null);

        String message = ex.getConstraintViolations().stream()
                .map(this::formatViolation)
                .collect(Collectors.joining(", "));

        if (message.isEmpty()) {
            message = ex.getMessage();
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("code", "bean_validation");
        if (firstField != null && !firstField.isEmpty()) {
            body.put("field", firstField);
        }
        body.put("message", message);

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    private String formatViolation(ConstraintViolation<?> v) {
        String path = v.getPropertyPath() == null ? "" : v.getPropertyPath().toString();
        String msg = v.getMessage() == null ? "invalid" : v.getMessage();
        return path.isEmpty() ? msg : (path + ": " + msg);
    }

    /**
     * Walks the cause chain and returns the deepest non-null message —
     * which is typically the JDBC driver's text containing the column /
     * constraint name. Falls back to the supplied exception's own
     * message if no deeper cause has one.
     */
    private String rootCauseMessage(Throwable ex) {
        Throwable current = ex;
        Throwable last = ex;
        // Defend against pathological cycles.
        int hops = 0;
        while (current.getCause() != null && current.getCause() != current && hops < 32) {
            current = current.getCause();
            if (current.getMessage() != null && !current.getMessage().isEmpty()) {
                last = current;
            }
            hops++;
        }
        return last.getMessage() == null ? "" : last.getMessage();
    }

    /**
     * Handles the {@code from-template} seed mode on
     * {@code POST /api/projects/{projectId}/target-architectures/seed}.
     *
     * <p>v1 ships the endpoint contract so the frontend can render the option as
     * disabled with an explanatory tooltip, but the template registry itself is
     * out of scope. Mapped to HTTP 501 Not Implemented with envelope including
     * {@code code: "template_mode_not_implemented"} so the UI can branch
     * cleanly on the structured error.</p>
     *
     * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 2.</p>
     */
    @ExceptionHandler(TemplateModeNotImplementedException.class)
    public ResponseEntity<Map<String, Object>> handleTemplateModeNotImplementedException(
            TemplateModeNotImplementedException ex) {
        log.warn("Target-architecture seed: from-template mode not implemented: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.NOT_IMPLEMENTED.value());
        body.put("error", "Not Implemented");
        body.put("code", "template_mode_not_implemented");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(body);
    }

    /**
     * Handles deterministic Suggest-from-current rejections where the source
     * current architecture has zero in-scope elements.
     *
     * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24) --
     * Phase 1 empty-source check.</p>
     *
     * <p>Returns HTTP 422 Unprocessable Entity with envelope including
     * {@code code: "empty_current_architecture"} so the Target State sub-tab
     * can surface the message inline (the existing error-banner pattern
     * branches on the code).</p>
     */
    @ExceptionHandler(EmptyCurrentArchitectureException.class)
    public ResponseEntity<Map<String, Object>> handleEmptyCurrentArchitectureException(
            EmptyCurrentArchitectureException ex) {
        log.warn("Suggest-from-current refused: empty current architecture: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("code", "empty_current_architecture");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    /**
     * Handles deterministic Suggest-from-current rejections where a draft
     * with the resolved auto-generated name was created within the last 5
     * seconds (server-side double-click guard complementing the frontend
     * pending-disable).
     *
     * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24) --
     * Phase 2 double-click guard.</p>
     *
     * <p>Returns HTTP 409 Conflict with envelope including
     * {@code code: "recent_duplicate_suggest"} so the workspace can branch
     * on the structured code and surface a "draft already created in the
     * last few seconds" message via the existing error banner.</p>
     */
    @ExceptionHandler(RecentDuplicateSuggestException.class)
    public ResponseEntity<Map<String, Object>> handleRecentDuplicateSuggestException(
            RecentDuplicateSuggestException ex) {
        log.warn("Suggest-from-current refused: recent duplicate: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.CONFLICT.value());
        body.put("error", "Conflict");
        body.put("code", "recent_duplicate_suggest");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }

    /**
     * Handles type-conversion failures on controller method arguments —
     * most commonly a malformed UUID path variable (e.g.
     * {@code GET /api/projects/not-a-uuid}). Without this handler the
     * exception falls through to the generic {@link Exception} catch-all
     * below and surfaces as an opaque 500 instead of the 400 that
     * Spring's default error mapping would have produced.
     *
     * Returns HTTP 400 with the standard JSON error response structure.
     */
    @ExceptionHandler(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> handleMethodArgumentTypeMismatchException(
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException ex) {
        log.warn("Method argument type mismatch: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    /**
     * Handles blank path variables that the conversion service turns into
     * {@code null} — e.g. {@code GET /api/projects/%20%20%20/product-summary}
     * where Spring's String-to-UUID converter trims the whitespace-only
     * segment to empty and returns {@code null}, producing
     * "present but converted to null". The variable WAS supplied by the
     * client, so this is a client error (400), not the server-side mapping
     * misconfiguration Spring's default 500 mapping assumes.
     *
     * Returns HTTP 400 with the standard JSON error response structure.
     */
    @ExceptionHandler(org.springframework.web.bind.MissingPathVariableException.class)
    public ResponseEntity<Map<String, Object>> handleMissingPathVariableException(
            org.springframework.web.bind.MissingPathVariableException ex) {
        log.warn("Missing or blank path variable: {}", ex.getMessage());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGenericException(Exception ex) {
        log.error("Internal server error: {}", ex.getMessage(), ex);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", OffsetDateTime.now());
        body.put("status", HttpStatus.INTERNAL_SERVER_ERROR.value());
        body.put("error", "Internal Server Error");
        body.put("message", "An unexpected error occurred");

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
    }
}
