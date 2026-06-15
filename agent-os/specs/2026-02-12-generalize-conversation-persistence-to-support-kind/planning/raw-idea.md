# Raw Idea

title: "Increment 2 – Generalize Conversation Persistence to Support <kind> (implement/product)"

intent:
  Reuse the existing gateway conversation persistence mechanism by introducing a conversation "kind"
  directory level so multiple conversation types can be stored without collisions.
  Persist paths become: <projectParentFolder>/conversations/<kind>/<derivedFolderName>/...
  Backward compatible: existing implement conversations continue to work with default kind="implement".

scope:
  include:
    - gateway-only change
    - extend existing implement-conversations GET/PUT to accept optional kind
    - store and read transcripts under conversations/<kind>/...
    - default kind="implement" when missing
    - validate kind against an allowlist: ["implement","product"]
    - ensure atomic writes remain unchanged (tmp + rename)
    - update frontend callers for implement flow to pass kind explicitly (optional; safe even if omitted)
  exclude:
    - any new product UI
    - any OpenAI/LLM changes
    - any MCP changes
    - any changes to architecture-model-service
    - any migration/relocation of existing on-disk folders (no data migration in this increment)

systems:
  primary: gateway

backend:
  gateway:
    existing_routes:
      - GET /api/implement-conversations
      - PUT /api/implement-conversations

    api_changes:
      query_params:
        - kind (optional; string; default "implement"; allowed: "implement" | "product")
      request_body:
        - kind (optional; string; default "implement"; allowed: "implement" | "product")
      precedence_rule:
        - If kind is present in body, use it; else if present in query, use it; else default "implement".

    pathing:
      current:
        root: <projectParentFolder>/conversations/<derivedFolderName>/
      new:
        root: <projectParentFolder>/conversations/<kind>/<derivedFolderName>/
      files:
        - conversation.json
        - full-conversation.txt

    validation_and_security:
      - Reject any kind not in ["implement","product"] with 400 and clear message.
      - Normalize kind to lower-case.
      - Ensure derivedFolderName generation remains unchanged (same deriveFolderName(featureTitle, featureId)).
      - projectParentFolder must continue to be required and used as the base directory.
      - Ensure no directory traversal is possible via kind (allowlist + no raw path concatenation without validation).

    implementation_tasks:
      - Introduce a small helper:
          normalizeKind(inputKind): returns "implement" or "product" or throws 400
      - Update transcript store/writer utilities to accept kind and incorporate it into base folder path.
      - Update GET handler to read from the <kind> path using the same derivation inputs.
      - Update PUT handler to write to the <kind> path using the same derivation inputs.
      - Maintain atomic write behavior (write temp file then rename) for both JSON and TXT outputs.

frontend:
  update_existing_implement_callers:
    - When calling GET/PUT implement-conversations, include kind="implement" explicitly (optional but preferred).
    - No UI changes; this is a transparent compatibility update.

acceptance_criteria:
  - Existing implement feature conversations still load/save correctly without providing kind (default implement).
  - Providing kind=implement stores under <projectParentFolder>/conversations/implement/<derivedFolderName>/...
  - Providing kind=product stores under <projectParentFolder>/conversations/product/<derivedFolderName>/...
  - GET returns the correct transcript for both kinds when invoked with matching kind.
  - Invalid kind returns HTTP 400 and does not write any files.
  - No other routes, LLM flows, or services are affected.
