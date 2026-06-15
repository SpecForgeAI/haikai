# Tasks: Job Recovery on Container Restart

## Task Group 1: Data model + storage
- [x] Add `resume_from_step` field to `Job` model (`job_models.py`)
- [x] Add `resume_from_step` column migration to `job_storage.py`
- [x] Update `save_job` to persist the new field
- [x] Update `_row_to_job` to load the new field

## Task Group 2: Orchestrator resume support
- [x] Add `start_from_step` parameter to `run_workflow()`
- [x] Add `on_step_complete` callback parameter to `run_workflow()`
- [x] Filter `self.COMMANDS` to skip steps before `start_from_step`
- [x] Call `on_step_complete` after each successful step

## Task Group 3: Task runner checkpointing + session restore
- [x] Import `JobProgress` and `ClaudeChatExecutor` in `tasks.py`
- [x] Save `logs_path` on job before running workflow
- [x] Add `on_step_complete` callback that checkpoints to `jobs.db`
- [x] Restore session from spec folder when `resume_from_step > 1`
- [x] Pass `start_from_step` and `on_step_complete` to `run_workflow()`

## Task Group 4: Startup recovery handler
- [x] Add `_determine_last_completed_step()` function in `api.py`
- [x] Add `_recover_interrupted_jobs()` function in `api.py`
- [x] Load session ID from spec-level `active_session.json`
- [x] Restore `.jsonl` transcript via `restore_session_from_spec()`
- [x] Re-queue recoverable jobs with `resume_from_step`
- [x] Mark non-recoverable jobs as `failed`
- [x] Dispatch recovered jobs in background threads
- [x] Run recovery on module load

## Task Group 5: Unit tests
- [x] Write `test_job_recovery.py` with tests from spec (11 tests, all passing)
