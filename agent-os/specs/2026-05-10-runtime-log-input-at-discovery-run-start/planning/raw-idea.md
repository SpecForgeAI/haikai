Runtime Log Input at Discovery Run Start

We need to implement Spec 4 of a 7-spec roadmap for discovery candidate evidence explainability and runtime log enrichment.

Context:
The Discovery Candidate Review flow currently allows users to start discovery runs for services/repos. In some flows, clicking "Start Discovery Run" from a service row opens an existing modal related to Libraries/service library scan before the run starts.

We now want users to optionally upload runtime log files when starting a discovery run. This spec only adds log input capture and storage as run input artifacts. It does not parse or process logs yet.

Roadmap context:
1. Candidate Details Expansion UI — done/shaped
2. Code Detection Detail Mappers — done/shaped
3. Candidate Evidence Data Contract — done/shaped
4. Runtime Log Input at Discovery Run Start — this spec
5. Web Access Log Runtime Endpoint Evidence
6. Log Evidence in Candidate Details UI
7. Confidence, Tier, and Runtime Badges

Goal:
Allow users to optionally upload one or more runtime log files from the browser when starting a discovery run, and attach/store those files as run input artifacts so later specs can process them.

This spec should not introduce log parsing, log-to-candidate matching, runtime evidence, confidence changes, tier changes, or UI evidence display beyond indicating that logs were attached/uploaded.

User experience:
When a user starts a discovery run, the run-start flow should support optional log upload.

There are two start-run UI cases:

1. Existing service library scan modal flow
If the user starts a discovery run from a service row and the current flow shows the Libraries/service library scan modal, add an "Upload Log Files" section to that existing modal.

2. Start-run flows without the Libraries modal
If a start-run flow currently does not show the Libraries modal, show a simple start-run modal that includes the same "Upload Log Files" capability and allows the user to continue without selecting files.

Log upload must be optional in both cases. If the user uploads no logs, the discovery run should start exactly as it does today.

Upload section:
Add a section titled:
"Upload Log Files"

Suggested helper text:
"Optional. Upload runtime log files to attach them to this discovery run. Log processing will be used by later discovery steps."

Accepted file types:
- .log
- .txt
- .jsonl
- .ndjson

Multiple files:
Support uploading multiple files in one run-start flow. Treat the selected files as one logical log bundle attached to the discovery run.

UI behavior:
- Users can select multiple files.
- Users can remove a selected file before starting the run.
- Users can start the run with zero files.
- Show selected file names and file sizes before submission.
- Show validation errors for unsupported file extensions.
- Keep the modal usable and readable when several files are selected.
- Do not block the existing library scan / start-run options.
- Existing start-run behavior must remain unchanged when no files are uploaded.

Storage requirement:
Uploaded log files should be stored as run input artifacts in the project's saved artifacts area, not in the database.

Do not store raw log contents in database fields.

The implementation should persist enough metadata to associate the uploaded log artifacts with the discovery run so later specs can retrieve/process them. This may include artifact IDs/paths, original file names, size, content type, uploaded timestamp, project ID, architecture ID, service ID, and discovery run ID if available.

Because the run ID may only be created when the run starts, choose an implementation that reliably associates uploaded files with the run:
- Either upload after/alongside run creation once run ID exists.
- Or upload to a temporary project/run-start artifact scope and finalize association after run creation.
Follow existing project artifact patterns in the codebase.

Frontend/API behavior:
The frontend should submit selected log files as part of the discovery run start flow or immediately adjacent to it.

Use multipart/form-data if that fits the existing architecture. If existing artifact upload APIs already exist, prefer reusing them rather than inventing a separate storage mechanism.

The Gateway should accept/forward the log file upload information as needed.

The Discovery Service should receive references/metadata for attached log artifacts as part of the run input, or receive enough information to retrieve them later in Spec 5.

The Architecture Model Service database should not store raw log contents.

Run metadata:
The discovery run should have a lightweight indication that log files were attached, such as:
- number of uploaded log files
- names/sizes of attached log artifacts
- artifact references/IDs/paths

If there is an existing config_snapshot or steps_payload mechanism suitable for this metadata, prefer using that rather than adding new database schema in this spec.

Run-start modal success behavior:
After the user starts the run:
- Existing run-start success behavior should remain unchanged.
- If logs were uploaded successfully, no additional blocking UI is required.
- If log upload fails before run start, show an error and allow the user to retry or remove logs and continue without logs.
- If the run starts but log attachment fails, show a clear error or warning. Avoid silently dropping selected logs.

Out of scope:
- Parsing log files
- Detecting log formats
- Extracting endpoint call counts
- Matching logs to endpoint/interface/logical entity candidates
- Populating the Log Scans evidence column
- Updating candidate confidence
- Updating tier labels
- Runtime badges
- LLM prompt changes
- Database persistence of raw log content
- Long-term log retention policy beyond storing as run input artifacts
- Compressed log files such as .gz or .zip
- Server-side file path input
- Drag-and-drop polish unless trivial within existing file upload components

Acceptance criteria:
1. Starting a discovery run from a service row with the existing Libraries/service library scan modal shows an "Upload Log Files" section in that modal.
2. Starting a discovery run from a flow that does not currently show the Libraries modal shows a simple modal with the same optional "Upload Log Files" capability.
3. Users can start discovery runs without uploading any logs, and behavior matches the existing no-log flow.
4. Users can select multiple log files.
5. Users can remove selected files before starting the run.
6. Only .log, .txt, .jsonl, and .ndjson files are accepted.
7. Unsupported file types produce a clear validation message and are not submitted.
8. Selected files display their file names and sizes before submission.
9. Uploaded log files are stored as run input artifacts in the project's saved artifacts area, not as raw database content.
10. The discovery run is associated with metadata/references for the uploaded log artifacts.
11. Existing library scan modal behavior remains intact.
12. Existing discovery run creation behavior remains intact when no logs are uploaded.
13. Upload failure before run start is surfaced to the user and does not leave them stuck.
14. Existing candidate review UI remains unchanged except for any run-level indication that logs were attached if already convenient.
15. No log parsing or runtime evidence extraction is introduced in this spec.
16. No confidence, tier, or candidate evidence display behavior is changed in this spec.
17. Tests are added or updated for the new upload UI and run-start behavior.

Implementation notes:
Inspect the existing frontend discovery run start flow first. Likely areas:
- frontend-src/src/components/Discovery
- frontend-src/src/api/discoveryApi.ts

Inspect the Gateway discovery routes and existing artifact upload/save mechanisms before adding new APIs. Likely areas:
- gateway-src/src/routes/discovery.ts
- gateway-src/src/server.ts
- any existing project artifact routes/clients

Inspect existing project saved artifact patterns. Prefer reusing existing artifact storage mechanisms over creating new persistence.

Suggested frontend shape:
- Add a reusable LogFileUploadInput component.
- Use it inside the existing Libraries/service library scan modal.
- Use it inside a simple start-run modal for flows without the Libraries modal.
- Keep selected files in modal state until the user confirms starting the run.
- Validate file extensions client-side.
- Include files in the start-run request or upload them immediately after run creation, depending on backend feasibility.

Suggested metadata shape:
{
  logArtifacts: [
    {
      artifactId: "...",
      originalFileName: "web_access.log",
      sizeBytes: 123456,
      fileType: ".log",
      contentType: "text/plain"
    }
  ]
}

The exact field names can follow existing project conventions.

Testing guidance:
Add or update tests for:
- Upload section appears in the existing Libraries modal.
- Simple start-run modal appears where no modal existed previously.
- No-file start still works.
- Multiple file selection works.
- File removal works.
- Unsupported file extensions are rejected.
- Accepted extensions are allowed.
- Start-run request includes or associates selected log artifacts.
- Existing start-run tests still pass.
