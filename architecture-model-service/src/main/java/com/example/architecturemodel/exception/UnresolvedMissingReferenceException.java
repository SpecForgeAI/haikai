package com.example.architecturemodel.exception;

/**
 * Thrown by the selective-copy commit path when a selected element has an
 * unresolved missing FK reference at submit time — typically because the
 * user manually un-ticked an auto-included element from the picker tree
 * before pressing {@code Commit copy}.
 *
 * <p>Mapped by {@link GlobalExceptionHandler} to HTTP 422 Unprocessable
 * Entity with an envelope including {@code code: "missing_reference"} so
 * the wizard's footer banner can explain that the user un-ticked an
 * auto-included element and must re-run preflight.</p>
 *
 * <p>Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)</p>
 */
public class UnresolvedMissingReferenceException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
        "Selected elements have unresolved missing references; "
        + "re-run preflight after re-including auto-selected elements.";

    public UnresolvedMissingReferenceException() {
        super(DEFAULT_MESSAGE);
    }

    public UnresolvedMissingReferenceException(String message) {
        super(message);
    }
}
