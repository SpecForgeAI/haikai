# Raw Idea

name: implement-open-questions-optimistic-user-message
scope:
  product_area: "Product & Delivery"
  screen: "Implement Feature"
  target: "Open Questions submission -> Team Chat transcript UX"
  services:
    - frontend

intent:
  - When the user clicks "Answer Open Questions", immediately render the user's Q&A message bubble in the Team Chat window (optimistic UI), instead of waiting for the Product Owner/LLM response.

changes:
  frontend:
    - Open Questions submit flow:
        - In the handler that submits open-question answers (the action that currently flips the button state to "Submitting..."), construct the same user-visible message content that is currently shown after the LLM responds (the Q/A formatted message).
        - Append this as a new "You" chat bubble to the Team Chat transcript immediately on click (before awaiting the network/LLM response).
        - Preserve the existing behavior of then sending the request to the backend/LLM and later appending the Product Owner response message when it arrives.

    - Failure / rollback behavior:
        - If the submission request fails, keep the optimistic user message visible, but clearly mark the submission as failed in UI state (e.g., toast/error banner) and allow retry (do not duplicate the optimistic message on retry).
        - Avoid creating duplicate "You" messages if the user clicks multiple times or retries while a submission is in-flight.

    - Ordering:
        - Ensure the optimistic user message appears immediately above the subsequent Product Owner response when it arrives (i.e., message order is preserved: You → Product Owner).

tests:
  - Add/update frontend tests to assert:
      - Clicking "Answer Open Questions" adds a "You" message to the transcript immediately (without waiting for the mocked LLM response).
      - The Product Owner response still appears when the request resolves.
      - Retries or double-clicks do not create duplicate optimistic user messages.
      - On error, an error indicator is shown.
