Now that you have, per task group, a list of objective acceptance criteria, write one rubric file per task group:

`haikai/specs/[this-spec]/rubrics/[task-group].md`

where `[task-group]` is the slugified parent task heading from `tasks.md`. Create the `rubrics/` directory if it does not exist.

## Rubric file format

Each rubric is a DETERMINISTIC pass/fail CHECKLIST. The `rubric-verifier` scores against these rows at verify time — it does NOT invent criteria — so every row must be a single, objective, checkable assertion.

Write each rubric file in this shape:

```markdown
# Rubric: [Task Group Name]

Spec: haikai/specs/[this-spec]/spec.md
Task group: [task-group]   touched_repos: [@repo:X, ...]

## Checklist

| # | Assertion | How to check |
|---|-----------|--------------|
| 1 | <one objective pass/fail condition> | <diff inspection / test that must pass / config key present> |
| 2 | ... | ... |
```

Rules for the rows:

- **One assertion per row.** If a row contains "and", split it.
- **Objective and checkable**, tied to a spec acceptance criterion. Good: "POST /comments returns 201 with a Location header on create"; "comment body field enforces a max length"; "failure path returns application/problem+json"; "verdict is recorded via `emit()` — no direct write to the verdicts table from the agent". Bad: "endpoint is good", "code is clean", "handles errors well".
- **Binary verdict.** Each row must resolve to exactly pass or fail when read against the diff (or a build/test the inline tools already run). No partial credit, no scores.
- **Self-contained.** A row must be scorable from the per-repo diff plus the task-group spec alone — do not assume the verifier remembers this conversation.
- **No framework pattern-matching baked in.** State the condition, not the build command. The `inline-runner` resolves concrete commands from the pinned discovery manifest (`coordination.lock.yaml`); the rubric only says WHAT must hold.
- Cover the group's acceptance criteria completely — every criterion from Phase 1 maps to at least one row; do not add rows that the spec does not justify.

## Boundary (keep explicit)

The rubric is scored by the non-deterministic `rubric-verifier`, which RETURNS a structured per-row result (pass/fail + evidence) for the runtime to record as one `(task_group, repo, rubric)` cell verdict. The rubric file does NOT write verdicts, evaluate the AND gate, or decide what the build tool is — the deterministic runtime owns the store, the gate, and `emit()`. Keep rubric rows about observable conditions only.

## Commit alongside the spec

Stage and commit the new `rubrics/[task-group].md` files together with the spec so fix-tasks regenerated later reuse the identical checklist.

## Display confirmation and next step

Display the following message to the user:

```
Rubrics have been created at `haikai/specs/[this-spec]/rubrics/` (one per task group) and committed alongside the spec.

NEXT STEP 👉 Run `/orchestrate-tasks` to start building — the rubric-verifier will score each diff against these checklists.
```

{{UNLESS standards_as_claude_code_skills}}
## User Standards & Preferences Compliance

IMPORTANT: Ensure that the rubric assertions are ALIGNED and DO NOT CONFLICT with the user's preferences and standards as detailed in the following files:

{{standards/*}}
{{ENDUNLESS standards_as_claude_code_skills}}
