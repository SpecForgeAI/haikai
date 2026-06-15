"""
Background worker process for executing queued jobs.

This module provides the worker process that polls the job queue
and executes jobs asynchronously.
"""

import os
import time
import signal
import sys
import importlib
import logging
from .job_storage import JobStorage
from .job_models import JobType
from . import tasks as _tasks_module

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class Worker:
    """Background worker for processing queued jobs."""
    
    def __init__(self, db_path: str = "jobs.db"):
        self.storage = JobStorage(db_path)
        self.running = True
        self.worker_id = os.getenv("WORKER_ID", "worker-1")
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)
    
    def _shutdown(self, signum, frame):
        """Graceful shutdown handler."""
        logger.info(f"Worker {self.worker_id}: Received shutdown signal, stopping...")
        self.running = False
    
    def _reload_modules(self):
        """Reload task modules and their dependencies to pick up code changes."""
        try:
            # Reload the modules that contain business logic
            import src.haikai_models
            import src.haikai_orchestrator
            import src.api_command_executor
            import src.haikai_service
            import src.chat.claude_chat_executor
            importlib.reload(src.haikai_models)
            importlib.reload(src.chat.claude_chat_executor)
            importlib.reload(src.haikai_orchestrator)
            importlib.reload(src.api_command_executor)
            importlib.reload(src.haikai_service)
            # Reload tasks module last (it imports the above)
            importlib.reload(_tasks_module)
            # Re-bind the task functions from the reloaded module
            global run_orchestration, run_write_spec, run_generate_tasks
            global run_implement_tasks, run_shape_spec, run_standards_product, run_standards_global
            global run_pipeline, run_verify_task_group, run_bug_investigation, run_haibox_verify
            run_orchestration = _tasks_module.run_orchestration
            run_write_spec = _tasks_module.run_write_spec
            run_generate_tasks = _tasks_module.run_generate_tasks
            run_implement_tasks = _tasks_module.run_implement_tasks
            run_shape_spec = _tasks_module.run_shape_spec
            run_standards_product = _tasks_module.run_standards_product
            run_standards_global = _tasks_module.run_standards_global
            run_pipeline = _tasks_module.run_pipeline
            run_verify_task_group = _tasks_module.run_verify_task_group
            run_bug_investigation = _tasks_module.run_bug_investigation
            run_haibox_verify = _tasks_module.run_haibox_verify
            logger.debug("Reloaded task modules")
        except Exception as e:
            logger.warning(f"Module reload failed (using cached): {e}")

    def run(self):
        """Main worker loop."""
        logger.info(f"Worker {self.worker_id}: Started")
        
        while self.running:
            try:
                # Get next queued job
                job = self.storage.get_next_queued_job()
                
                if job:
                    # Reload modules to pick up code changes (hot-reload)
                    self._reload_modules()

                    logger.info(
                        f"Worker {self.worker_id}: Processing job {job.job_id} "
                        f"(type: {job.type}, company: {job.company}, project: {job.project})"
                    )
                    
                    try:
                        # Execute job based on type
                        if job.type == JobType.ORCHESTRATION:
                            run_orchestration(job.job_id, self.storage)
                        elif job.type == JobType.WRITE_SPEC:
                            run_write_spec(job.job_id, self.storage)
                        elif job.type == JobType.GENERATE_TASKS:
                            run_generate_tasks(job.job_id, self.storage)
                        elif job.type == JobType.IMPLEMENT_TASKS:
                            run_implement_tasks(job.job_id, self.storage)
                        elif job.type == JobType.SHAPE_SPEC:
                            run_shape_spec(job.job_id, self.storage)
                        elif job.type == JobType.STANDARDS_PRODUCT:
                            run_standards_product(job.job_id, self.storage)
                        elif job.type == JobType.STANDARDS_GLOBAL:
                            run_standards_global(job.job_id, self.storage)
                        elif job.type == JobType.RUN_PIPELINE:
                            run_pipeline(job.job_id, self.storage)
                        elif job.type == JobType.VERIFY_TASK_GROUP:
                            run_verify_task_group(job.job_id, self.storage)
                        elif job.type == JobType.BUG_INVESTIGATION:
                            run_bug_investigation(job.job_id, self.storage)
                        elif job.type == JobType.HAIBOX_VERIFY:
                            run_haibox_verify(job.job_id, self.storage)
                        else:
                            logger.error(f"Worker {self.worker_id}: Unknown job type: {job.type}")
                        
                        logger.info(f"Worker {self.worker_id}: Job {job.job_id} completed")
                        
                    except Exception as e:
                        logger.error(
                            f"Worker {self.worker_id}: Job {job.job_id} failed: {str(e)}",
                            exc_info=True
                        )
                
                else:
                    # No jobs, sleep briefly
                    time.sleep(1)
            
            except Exception as e:
                logger.error(
                    f"Worker {self.worker_id}: Unexpected error in main loop: {str(e)}",
                    exc_info=True
                )
                time.sleep(5)  # Sleep longer on unexpected errors
        
        logger.info(f"Worker {self.worker_id}: Stopped")


def main():
    """Entry point for worker process."""
    from src.safe_paths import jobs_db_path
    db_path = jobs_db_path()
    
    logger.info(f"Starting worker with database: {db_path}")
    
    worker = Worker(db_path)
    worker.run()


if __name__ == "__main__":
    main()
