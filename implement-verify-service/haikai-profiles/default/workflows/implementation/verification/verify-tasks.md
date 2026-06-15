<!-- NOTE: This is the /implement-tasks box-check — it confirms tasks.md checkboxes against implementation reports for a single spec. It is NOT the async cross-repo verification gate. That is the `verify-task-group` command (commands/verify-task-group/), which gates per-`(group, repo)` cell on the D5 AND gate. Don't conflate the two. -->

Check `haikai/specs/[this-spec]/tasks.md` and ensure that all tasks and their sub-tasks are marked as completed with `- [x]`.

If a task is still marked incomplete, then verify that it has in fact been completed by checking the following:
- Run a brief spot check in the code to find evidence that this task's details have been implemented
- Check for existence of an implementation report titled using this task's title in `haikai/spec/[this-spec]/implementation/` folder.

IF you have concluded that this task has been completed, then mark it's checkbox and its' sub-tasks checkboxes as completed with `- [x]`.

IF you have concluded that this task has NOT been completed, then mark this checkbox with ⚠️ and note it's incompleteness in your verification report.
