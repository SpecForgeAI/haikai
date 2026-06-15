package com.example.architecturemodel.exception;

/**
 * Thrown when a {@code from-template} seed mode is requested on
 * {@code POST /api/projects/{projectId}/target-architectures/seed}.
 *
 * <p>v1 ships the endpoint contract so the frontend can render the option as
 * disabled with an explanatory tooltip, but the template registry itself is
 * out of scope (see spec.md "Seeding modes" section + Out of Scope).</p>
 *
 * <p>Mapped by {@link GlobalExceptionHandler} to HTTP 501 Not Implemented
 * with an envelope including {@code code: "template_mode_not_implemented"}
 * so the UI can branch cleanly on the structured error.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 2.</p>
 */
public class TemplateModeNotImplementedException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
        "Seeding from a template is not implemented in v1. "
        + "Use 'clone-current' or 'blank' instead.";

    public TemplateModeNotImplementedException() {
        super(DEFAULT_MESSAGE);
    }

    public TemplateModeNotImplementedException(String message) {
        super(message);
    }
}
