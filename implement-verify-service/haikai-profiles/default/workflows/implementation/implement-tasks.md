## Working Directory

Read `haikai/specs/[this-spec]/planning/target-repo.md` for the `target_folder` value. Write ALL generated source code into that subdirectory (e.g. `api/` or `web/`). Do NOT write source files at the project root - they must go inside the target folder.

Implement all tasks assigned to you and ONLY those task(s) that have been assigned to you.

## Implementation process:

1. Analyze the provided spec.md, requirements.md, and visuals (if any)
2. Analyze patterns in the codebase according to its built-in workflow
3. Implement the assigned task group according to requirements and standards
4. Update `haikai/specs/[this-spec]/tasks.md` to update the tasks you've implemented to mark that as done by updating their checkbox to checked state: `- [x]`

## A task you genuinely CANNOT complete: mark it BLOCKED, never leave it unticked

There are exactly THREE checkbox states, and the orchestrator reads them to
decide whether this step succeeded. It parses the boxes; it cannot infer your
intent from prose, a note, or an emoji.

- `- [x]` — done.
- `- [~] <task> — BLOCKED: <why>` — provably impossible in THIS environment or on
  THIS branch. The step still PASSES on what was achievable and the blocked
  items are recorded against it.
- `- [ ]` — not done and not blocked. **ANY remaining `- [ ]` FAILS the step and
  halts the whole run**, discarding every other task group you completed.

Rules that decide between a passing step and a lost run:

- The marker MUST be exactly `[~]`. A `[ ]` box carrying a warning emoji, a
  note, or a "BLOCKED, see 5.1" comment is read as an ordinary unfinished task
  and fails the step.
- After the word `BLOCKED` you MUST state WHY. A bare
  `- [~] 5.0 Implement the exception type` with no reason is malformed and also
  fails the step — `[~]` is not an escape hatch for work you found hard.
  Punctuation is not dictated: `BLOCKED: <why>`, `BLOCKED — <why>` and
  `BLOCKED for `mvn -q clean verify`: <why>` are all accepted. Naming WHICH
  command or artefact is blocked before explaining why is encouraged.
- The reason may sit on the box's own line, on a WRAPPED continuation of that
  line, or on any MORE-INDENTED line beneath it, so a parent summarising blocked
  children need not restate their reasons.
- NEVER invent a stub, placeholder or `Object`-typed stand-in to turn a blocked
  task into a ticked one. A local duplicate of a type another spec owns will be
  silently shadowed when that spec lands. Mark it blocked and state why.

Correct — the step passes with the gap recorded:

```
- [x] 4.2 Add the carried enums
- [~] 5.0 Implement ValueLengthException — BLOCKED: its hierarchyFilter field
      types against core.domain.HierarchyFilter, which the
      dto-domain-shapes-part-2 spec carries. Absent from this branch; a stub
      would be shadowed later.
```

Wrong — both of these fail the step and halt the run:

```
- [ ] ⚠️ 5.0 Implement the exception type — BLOCKED, see 5.1
- [~] 5.0 Implement the exception type
```


## Guide your implementation using:
- **The existing patterns** that you've found and analyzed in the codebase.
- **Specific notes provided in requirements.md, spec.md AND/OR tasks.md**
- **Visuals provided (if any)** which would be located in `haikai/specs/[this-spec]/planning/visuals/`
- **User Standards & Preferences** which are defined below.

## Self-verify and test your work by:
- Running ONLY the tests you've written (if any) and ensuring those tests pass.
- IF your task involves user-facing UI, and IF you have access to browser testing tools, open a browser and use the feature you've implemented as if you are a user to ensure a user can use the feature in the intended way.
  - Take screenshots of the views and UI elements you've tested and store those in `haikai/specs/[this-spec]/verification/screenshots/`.  Do not store screenshots anywhere else in the codebase other than this location.
  - Analyze the screenshot(s) you've taken to check them against your current requirements.
