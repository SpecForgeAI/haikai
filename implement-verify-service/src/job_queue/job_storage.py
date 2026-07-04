"""
SQLite-based storage layer for job metadata.
"""

import sqlite3
import json
from contextlib import contextmanager
from pathlib import Path
from typing import Optional, List
from datetime import datetime, timedelta, timezone
from .job_models import Job, JobStatus, JobType, JobProgress


class JobStorage:
    """SQLite-based storage for job metadata."""

    def __init__(self, db_path: str = "jobs.db"):
        self.db_path = db_path
        self._init_db()

    @contextmanager
    def _connect(self, *, isolation_level: Optional[str] = None, row_factory=None):
        """Open a sqlite connection and guarantee close on exit.

        Replaces the prior pattern of `conn = sqlite3.connect(...); ...;
        conn.close()` which leaked the connection if anything in between
        raised. Use as `with self._connect() as conn:`.
        """
        conn = sqlite3.connect(self.db_path, isolation_level=isolation_level) \
            if isolation_level is not None else sqlite3.connect(self.db_path)
        # Parallel-N hardening: without a busy_timeout a concurrent writer gets
        # an instant "database is locked" (the verification store already sets
        # this — store.py; jobs.db was the gap). 5s matches the store.
        conn.execute("PRAGMA busy_timeout=5000")
        if row_factory is not None:
            conn.row_factory = row_factory
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self):
        """Initialize database schema."""
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    company TEXT NOT NULL,
                    project TEXT NOT NULL,
                    request_payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    progress_json TEXT,
                    result_json TEXT,
                    error TEXT,
                    worker_id TEXT,
                    logs_path TEXT
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_status ON jobs(status)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_created_at ON jobs(created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_company_project ON jobs(company, project)")

            # Liveness heartbeats for running jobs. Kept in a SEPARATE table so
            # save_job's INSERT OR REPLACE on `jobs` can't clobber a fresh beat.
            # Recovery uses it to tell a job a live worker is actively running from
            # one a dead process orphaned (don't mark the former failed).
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS job_heartbeats (
                    job_id TEXT PRIMARY KEY,
                    last_heartbeat TEXT NOT NULL
                )
            """)

            # Migration: add resume_from_step column for job recovery.
            # Check for the column instead of swallowing OperationalError, which
            # would also hide unrelated failures (locked DB, disk full, etc.).
            cursor.execute("PRAGMA table_info(jobs)")
            existing_cols = {row[1] for row in cursor.fetchall()}
            if "resume_from_step" not in existing_cols:
                cursor.execute("ALTER TABLE jobs ADD COLUMN resume_from_step INTEGER")
            # Parallel-worktrees (spec v2 D13/D14): worktree ownership +
            # per-spec resume bookkeeping. ALTER order here MUST match the
            # positional column order appended in save_job's VALUES tuple.
            for col, typ in (
                ("spec_idx", "INTEGER"),
                ("last_committed_spec_idx", "INTEGER"),
                ("run_branch", "TEXT"),
                ("worktree_root", "TEXT"),
            ):
                if col not in existing_cols:
                    cursor.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")

            # Tracked process handles (pid / process-group) per job — kept in
            # a SEPARATE table (like heartbeats) so save_job's whole-row
            # INSERT OR REPLACE can't clobber a fresh registration. The
            # job-OWNING process kills via this handle (D13); cross-process
            # liveness is heartbeat-based, never PID.
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS job_processes (
                    job_id TEXT NOT NULL,
                    pid INTEGER NOT NULL,
                    owner TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (job_id, pid)
                )
            """)
            # Migration: the first cut had job_id as sole PK — one tracked pid
            # per job. Per-spec parallel mode (D1) runs N concurrent sessions
            # per job, so the key is composite. Rebuild if the old shape exists.
            cursor.execute("PRAGMA table_info(job_processes)")
            pk_cols = [r[1] for r in cursor.fetchall() if r[5] > 0]
            if pk_cols == ["job_id"]:
                cursor.execute("ALTER TABLE job_processes RENAME TO job_processes_old")
                cursor.execute("""
                    CREATE TABLE job_processes (
                        job_id TEXT NOT NULL,
                        pid INTEGER NOT NULL,
                        owner TEXT,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (job_id, pid)
                    )
                """)
                cursor.execute(
                    "INSERT OR IGNORE INTO job_processes "
                    "SELECT job_id, pid, owner, updated_at FROM job_processes_old")
                cursor.execute("DROP TABLE job_processes_old")
            conn.commit()
    
    def save_job(self, job: Job):
        """Save or update job."""
        with self._connect() as conn:
            cursor = conn.cursor()
            # NB: positional — the trailing columns MUST stay in the ALTER
            # order declared in _init_db (resume_from_step, spec_idx,
            # last_committed_spec_idx, run_branch, worktree_root).
            cursor.execute("""
                INSERT OR REPLACE INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job.job_id,
                job.type.value if isinstance(job.type, JobType) else job.type,
                job.status.value if isinstance(job.status, JobStatus) else job.status,
                job.company,
                job.project,
                json.dumps(job.request_payload),
                job.created_at.isoformat(),
                job.started_at.isoformat() if job.started_at else None,
                job.completed_at.isoformat() if job.completed_at else None,
                json.dumps(job.progress.dict()) if job.progress else None,
                json.dumps(job.result) if job.result else None,
                job.error,
                job.worker_id,
                job.logs_path,
                job.resume_from_step,
                job.spec_idx,
                job.last_committed_spec_idx,
                job.run_branch,
                job.worktree_root
            ))
            conn.commit()

    def beat(self, job_id: str) -> None:
        """Stamp a liveness heartbeat for a running job."""
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO job_heartbeats (job_id, last_heartbeat) VALUES (?, ?)",
                (job_id, datetime.now(timezone.utc).isoformat()),
            )
            conn.commit()

    def heartbeat_age_seconds(self, job_id: str) -> Optional[float]:
        """Seconds since the last heartbeat for `job_id`, or None if never beat."""
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT last_heartbeat FROM job_heartbeats WHERE job_id = ?", (job_id,))
            row = cur.fetchone()
        if not row or not row[0]:
            return None
        try:
            ts = datetime.fromisoformat(row[0])
        except ValueError:
            return None
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - ts).total_seconds()

    def get_job(self, job_id: str) -> Optional[Job]:
        """Get job by ID."""
        with self._connect(row_factory=sqlite3.Row) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()
        if not row:
            return None
        return self._row_to_job(row)
    
    def claim_next_queued_job(self, worker_id: str = "worker-1") -> Optional[Job]:
        """Atomically claim the next queued job (FIFO).

        Flips status QUEUED → RUNNING in the same transaction the SELECT runs
        in, so two concurrent workers can't pick the same job. Returns None
        if no QUEUED jobs exist.
        """
        with self._connect(isolation_level="IMMEDIATE", row_factory=sqlite3.Row) as conn:
            cursor = conn.cursor()
            while True:
                cursor.execute("""
                    SELECT job_id FROM jobs
                    WHERE status IN (?, ?)
                    ORDER BY created_at ASC
                    LIMIT 1
                """, (JobStatus.QUEUED.value, JobStatus.QUEUED_FOR_RESUME.value))
                row = cursor.fetchone()
                if not row:
                    return None

                # Atomic claim: only update if still queued (fresh or
                # queued-for-resume). Another worker may have grabbed it
                # between our SELECT and UPDATE.
                cursor.execute("""
                    UPDATE jobs
                    SET status = ?, started_at = ?, worker_id = ?
                    WHERE job_id = ? AND status IN (?, ?)
                """, (
                    JobStatus.RUNNING.value,
                    datetime.now(timezone.utc).isoformat(),
                    worker_id,
                    row['job_id'],
                    JobStatus.QUEUED.value,
                    JobStatus.QUEUED_FOR_RESUME.value,
                ))
                if cursor.rowcount == 0:
                    # Lost the race; loop and try the next queued job.
                    conn.commit()
                    continue
                conn.commit()
                cursor.execute("SELECT * FROM jobs WHERE job_id = ?", (row['job_id'],))
                full_row = cursor.fetchone()
                return self._row_to_job(full_row)

    # Backwards-compatible shim — callers that don't supply a worker_id get the
    # claim-as-default-worker behavior. Deprecated; prefer claim_next_queued_job.
    def get_next_queued_job(self) -> Optional[Job]:
        return self.claim_next_queued_job()

    def claim_job(self, job_id: str, worker_id: str) -> bool:
        """Atomically claim a SPECIFIC queued job (CAS QUEUED → RUNNING).

        Used by the API-background execution path so it cannot double-execute
        a job a polling worker already claimed (and vice versa). Returns True
        iff this caller won the claim.
        """
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE jobs
                SET status = ?, started_at = ?, worker_id = ?
                WHERE job_id = ? AND status IN (?, ?)
                """,
                (
                    JobStatus.RUNNING.value,
                    datetime.now(timezone.utc).isoformat(),
                    worker_id,
                    job_id,
                    JobStatus.QUEUED.value,
                    JobStatus.QUEUED_FOR_RESUME.value,
                ),
            )
            conn.commit()
            return cursor.rowcount == 1
    
    def list_jobs(
        self,
        status: Optional[JobStatus] = None,
        company: Optional[str] = None,
        project: Optional[str] = None,
        limit: int = 100
    ) -> List[Job]:
        """List jobs with filters."""
        with self._connect(row_factory=sqlite3.Row) as conn:
            cursor = conn.cursor()
            query = "SELECT * FROM jobs WHERE 1=1"
            params = []
            if status:
                query += " AND status = ?"
                params.append(status.value if isinstance(status, JobStatus) else status)
            if company:
                query += " AND company = ?"
                params.append(company)
            if project:
                query += " AND project = ?"
                params.append(project)
            query += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return [self._row_to_job(row) for row in rows]

    def delete_job(self, job_id: str):
        """Delete job."""
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
            conn.commit()

    def cancel_job(self, job_id: str) -> bool:
        """Two-phase cancel (spec v2 D13): cancel REQUESTS termination.

        QUEUED / QUEUED_FOR_RESUME → CANCELLED immediately (no process).
        RUNNING / RECOVERING → CANCELLING; the job-OWNING process observes
        it, kills its tracked tree, then confirms via mark_cancelled().
        Returns True if any transition happened.
        """
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE jobs SET status = ?, completed_at = ? "
                "WHERE job_id = ? AND status IN (?, ?)",
                (JobStatus.CANCELLED.value, now, job_id,
                 JobStatus.QUEUED.value, JobStatus.QUEUED_FOR_RESUME.value),
            )
            if cursor.rowcount > 0:
                conn.commit()
                return True
            cursor.execute(
                "UPDATE jobs SET status = ? "
                "WHERE job_id = ? AND status IN (?, ?)",
                (JobStatus.CANCELLING.value, job_id,
                 JobStatus.RUNNING.value, JobStatus.RECOVERING.value),
            )
            conn.commit()
            return cursor.rowcount > 0

    def mark_cancelled(self, job_id: str) -> bool:
        """Owner-side confirmation: CANCELLING → CANCELLED after the tracked
        process tree is confirmed dead. Reclaim eligibility starts here."""
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE jobs SET status = ?, completed_at = ? "
                "WHERE job_id = ? AND status = ?",
                (JobStatus.CANCELLED.value,
                 datetime.now(timezone.utc).isoformat(),
                 job_id, JobStatus.CANCELLING.value),
            )
            conn.commit()
            return cursor.rowcount > 0

    # ── tracked process handles (D13) ────────────────────────────────────
    def track_process(self, job_id: str, pid: int, owner: str = "") -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO job_processes (job_id, pid, owner, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (job_id, pid, owner, datetime.now(timezone.utc).isoformat()),
            )
            conn.commit()

    def tracked_pid(self, job_id: str) -> Optional[int]:
        """Most recently tracked pid (single-session jobs). Per-spec parallel
        jobs have several — use tracked_pids for kill loops."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT pid FROM job_processes WHERE job_id = ? "
                "ORDER BY updated_at DESC LIMIT 1", (job_id,)
            ).fetchone()
        return row[0] if row else None

    def tracked_pids(self, job_id: str) -> List[int]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT pid FROM job_processes WHERE job_id = ?", (job_id,)
            ).fetchall()
        return [r[0] for r in rows]

    def clear_process(self, job_id: str, pid: Optional[int] = None) -> None:
        with self._connect() as conn:
            if pid is None:
                conn.execute("DELETE FROM job_processes WHERE job_id = ?", (job_id,))
            else:
                conn.execute("DELETE FROM job_processes WHERE job_id = ? AND pid = ?",
                             (job_id, pid))
            conn.commit()

    def cleanup_old_jobs(self, days: int = 7):
        """Delete completed/failed jobs older than specified days."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                DELETE FROM jobs
                WHERE status IN (?, ?)
                AND created_at < ?
            """, (JobStatus.COMPLETED.value, JobStatus.FAILED.value, cutoff.isoformat()))
            deleted = cursor.rowcount
            conn.commit()
        return deleted
    
    def _row_to_job(self, row: sqlite3.Row) -> Job:
        """Convert SQLite row to Job object."""
        try:
            progress_data = json.loads(row['progress_json']) if row['progress_json'] else None
            progress = JobProgress(**progress_data) if progress_data else None
        except (json.JSONDecodeError, TypeError, ValueError):
            progress = None
        
        try:
            result = json.loads(row['result_json']) if row['result_json'] else None
        except json.JSONDecodeError:
            result = None
        
        try:
            request_payload = json.loads(row['request_payload'])
        except json.JSONDecodeError:
            request_payload = {}
        
        # Handle resume_from_step (may not exist in older DBs)
        try:
            resume_from_step = row['resume_from_step']
        except (IndexError, KeyError):
            resume_from_step = None

        def _opt(col):
            try:
                return row[col]
            except (IndexError, KeyError):
                return None

        return Job(
            spec_idx=_opt('spec_idx'),
            last_committed_spec_idx=_opt('last_committed_spec_idx'),
            run_branch=_opt('run_branch'),
            worktree_root=_opt('worktree_root'),
            job_id=row['job_id'],
            type=JobType(row['type']),
            status=JobStatus(row['status']),
            company=row['company'],
            project=row['project'],
            request_payload=request_payload,
            created_at=datetime.fromisoformat(row['created_at']),
            started_at=datetime.fromisoformat(row['started_at']) if row['started_at'] else None,
            completed_at=datetime.fromisoformat(row['completed_at']) if row['completed_at'] else None,
            progress=progress,
            result=result,
            error=row['error'],
            worker_id=row['worker_id'],
            logs_path=row['logs_path'],
            resume_from_step=resume_from_step
        )
