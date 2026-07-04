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
            conn.commit()
    
    def save_job(self, job: Job):
        """Save or update job."""
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                job.resume_from_step
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
                    WHERE status = ?
                    ORDER BY created_at ASC
                    LIMIT 1
                """, (JobStatus.QUEUED.value,))
                row = cursor.fetchone()
                if not row:
                    return None

                # Atomic claim: only update if still QUEUED. Another worker may
                # have grabbed it between our SELECT and UPDATE.
                cursor.execute("""
                    UPDATE jobs
                    SET status = ?, started_at = ?, worker_id = ?
                    WHERE job_id = ? AND status = ?
                """, (
                    JobStatus.RUNNING.value,
                    datetime.now(timezone.utc).isoformat(),
                    worker_id,
                    row['job_id'],
                    JobStatus.QUEUED.value,
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
                WHERE job_id = ? AND status = ?
                """,
                (
                    JobStatus.RUNNING.value,
                    datetime.now(timezone.utc).isoformat(),
                    worker_id,
                    job_id,
                    JobStatus.QUEUED.value,
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
        """Atomically flip a job to CANCELLED if it is still cancellable.

        Returns True if the row was updated (status was QUEUED or RUNNING),
        False if the job doesn't exist or has already terminated.
        """
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE jobs
                SET status = ?, completed_at = ?
                WHERE job_id = ? AND status IN (?, ?)
                """,
                (
                    JobStatus.CANCELLED.value,
                    datetime.now(timezone.utc).isoformat(),
                    job_id,
                    JobStatus.QUEUED.value,
                    JobStatus.RUNNING.value,
                ),
            )
            conn.commit()
            return cursor.rowcount > 0

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

        return Job(
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
