Now that you have the task group(s) to be implemented, proceed with implementation by following these instructions:

{{workflows/implementation/implement-tasks}}

## Display confirmation and proceed to Phase 3

Display a summary of what was implemented.

IF all tasks are now marked as done (with `- [x]`) in tasks.md, display this message:

```
All tasks have been implemented: `haikai/specs/[this-spec]/tasks.md`.

Proceeding to Phase 3: `3-verify-implementation.md` (verification report).
```

**Then IMMEDIATELY continue to Phase 3** — load and execute `3-verify-implementation.md` without stopping. Phase 3 is MANDATORY and runs automatically. Do NOT wait for user input; Phase 3 must always run after Phase 2 completes, regardless of whether tests passed on the first try. The verification report at `haikai/specs/[this-spec]/verification/final-verification.md` is a required deliverable.

IF there are still tasks in tasks.md that have yet to be implemented (marked unfinished with `- [ ]`) then display this message to user:

```
Remaining tasks in tasks.md are not yet implemented.

To continue implementation, run `/implement-tasks` again or specify which task group(s) to implement next.
```

{{UNLESS standards_as_claude_code_skills}}
## User Standards & Preferences Compliance

IMPORTANT: Ensure that the tasks list is ALIGNED and DOES NOT CONFLICT with the user's preferences and standards as detailed in the following files:

{{standards/*}}
{{ENDUNLESS standards_as_claude_code_skills}}
