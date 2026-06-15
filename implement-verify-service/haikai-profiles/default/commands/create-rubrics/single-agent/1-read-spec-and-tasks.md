The FIRST STEP is to make sure you have ALL THREE of these files for this spec in your current conversation context:
- `haikai/specs/[this-spec]/spec.md`
- `haikai/specs/[this-spec]/planning/requirements.md`
- `haikai/specs/[this-spec]/tasks.md`

IF you are missing `tasks.md`, then ask the user where to find it by outputting the following request, then wait for the user's response:

"I'll need `tasks.md` (and the spec.md / requirements.md that informed it) in order to write rubrics.

Please direct me to where I can find them.  If you haven't created tasks yet, run /create-tasks first."

## Read the inputs

Read `spec.md` and `requirements.md` to recover the acceptance criteria — the objective, observable conditions that define "this is built correctly." Read `tasks.md` to recover the task groups (parent task headings) and their `[@repo:X]` annotations.

## For each task group, identify the verifiable acceptance criteria

Work through `tasks.md` parent task by parent task. For each task group:

1. Note the task-group name (the slugified parent heading) — this becomes the rubric filename.
2. Trace each task and sub-task back to the acceptance criteria in `spec.md` / `requirements.md` that it satisfies.
3. List, for that group, the conditions that are OBJECTIVELY CHECKABLE against the resulting diff or a running build — e.g. "new endpoint returns 201 on create", "input field has a length bound", "error path returns problem+json", "verdict is written through `emit()`, not by mutating the store directly". Reject anything you cannot turn into a single pass/fail assertion ("code is good", "well structured", "clean").
4. If a task group has acceptance criteria that are genuinely not checkable from the diff alone, note that explicitly so Phase 2 can phrase the row against the nearest observable proxy (a test that must exist, a config key that must be present) rather than a vibe.

Do NOT encode framework-specific pattern matching here. Reason from what the spec and tasks actually assert. The rubric rows describe WHAT must hold; the `rubric-verifier` and `inline-runner` decide HOW to check at verify time against the discovered build commands.

Carry forward, per task group, the list of candidate checklist assertions. Phase 2 turns each list into a committed rubric file.

{{UNLESS compiled_single_command}}
## Display confirmation and next step

Once you have the spec, requirements, and tasks, and have drafted the per-group assertion lists, output the following message (replace `[this-spec]` with the spec folder name):

```
✅ I have spec.md, requirements.md, and tasks.md for `[this-spec]`, and have identified verifiable acceptance criteria per task group.

NEXT STEP 👉 Run the command, 2-write-rubrics.md
```
{{ENDUNLESS compiled_single_command}}
