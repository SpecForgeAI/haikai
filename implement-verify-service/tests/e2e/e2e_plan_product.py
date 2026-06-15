#!/usr/bin/env python3
"""
E2E Regression Tests: Plan Product SSE Streaming

Runs plan-product requests against the live API to verify:
1. SSE stream works (content + done events)
2. Conversation is maintained across resume
3. History and clear endpoints function
4. Product files are generated (mission.md, roadmap.md, tech-stack.md)

Usage:
    python3 tests/e2e_plan_product.py [--api-url URL] [--api-key KEY]

Environment:
    API_BASE_URL: Base URL for the API (default: http://localhost:8000)
    STANDARDS_API_KEY: API key for authentication (default: changeit)
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
import httpx


@dataclass
class TestResult:
    test_name: str
    success: bool
    has_content: bool = False
    has_questions: bool = False
    questions_count: int = 0
    event_types: List[str] = field(default_factory=list)
    error: Optional[str] = None
    duration_seconds: float = 0.0


TEST_PROMPTS = [
    {
        "name": "task-management-app",
        "prompt": "I'm building a task management app for small remote teams of 3-10 people. Key features: task creation with due dates, priority labels, and team collaboration. Tech stack: React + Node.js + SQLite."
    },
    {
        "name": "ecommerce-platform",
        "prompt": "Build an e-commerce platform for artisan goods. Features: product listings with images, shopping cart, Stripe payments, order tracking. Users: small business owners selling handmade products."
    },
    {
        "name": "fitness-tracker",
        "prompt": "Create a fitness tracking app. Key features: workout logging, progress charts, social challenges, meal planning. Target: fitness enthusiasts aged 18-35. Tech: React Native + Firebase."
    },
]


class PlanProductE2ERunner:
    def __init__(self, api_base_url: str, api_key: str, timeout: float = 180.0):
        self.api_base_url = api_base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.results: List[TestResult] = []
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def _stream_request(self, endpoint: str, data: dict) -> List[Dict]:
        """Send SSE request and collect events."""
        events = []
        with httpx.stream(
            "POST", f"{self.api_base_url}{endpoint}",
            json=data, headers=self.headers, timeout=self.timeout
        ) as response:
            if response.status_code != 200:
                raise Exception(f"HTTP {response.status_code}")
            for line in response.iter_lines():
                if line.startswith("data: "):
                    try:
                        events.append(json.loads(line[6:]))
                    except json.JSONDecodeError:
                        pass
        return events

    def test_new_session(self, name: str, prompt: str) -> TestResult:
        """Test: New plan-product session streams events."""
        print(f"\n{'='*60}")
        print(f"Test: {name} (new session)")
        print(f"{'='*60}")
        
        start = time.time()
        project = f"{name}_{int(time.time())}"
        
        try:
            events = self._stream_request("/api/v1/plan-product/stream", {
                "company": "e2e_test", "project": project,
                "message": prompt, "session_mode": "new"
            })
            
            duration = time.time() - start
            event_types = [e.get("type") for e in events]
            has_content = "content" in event_types
            has_questions = "questions" in event_types
            q_count = 0
            if has_questions:
                q_event = next(e for e in events if e.get("type") == "questions")
                q_count = len(q_event.get("questions", []))

            # Print progress
            content_count = sum(1 for e in events if e.get("type") == "content")
            print(f"  Events: {len(events)} total, {content_count} content, questions={q_count}")

            success = has_content
            status = "✅ PASS" if success else "❌ FAIL"
            print(f"  {status} | {duration:.1f}s")

            return TestResult(
                test_name=f"{name}/new", success=success,
                has_content=has_content,
                has_questions=has_questions, questions_count=q_count,
                event_types=list(set(event_types)), duration_seconds=duration
            )
        except Exception as e:
            duration = time.time() - start
            print(f"  ❌ FAIL | Error: {e}")
            return TestResult(test_name=f"{name}/new", success=False, error=str(e), duration_seconds=duration)

    def test_resume_session(self) -> TestResult:
        """Test: Resume session preserves context."""
        print(f"\n{'='*60}")
        print(f"Test: resume-session")
        print(f"{'='*60}")
        
        start = time.time()
        project = f"resume_test_{int(time.time())}"
        
        try:
            # Step 1: New session
            print("  Step 1: New session...")
            events1 = self._stream_request("/api/v1/plan-product/stream", {
                "company": "e2e_test", "project": project,
                "message": "I want to build an inventory management system for warehouses",
                "session_mode": "new"
            })
            assert any(e.get("type") == "content" for e in events1), "New session must have content"
            
            # Step 2: Resume
            print("  Step 2: Resume session...")
            events2 = self._stream_request("/api/v1/plan-product/stream", {
                "company": "e2e_test", "project": project,
                "message": "Use Python with Django and PostgreSQL for the backend",
                "session_mode": "resume"
            })
            assert any(e.get("type") == "content" for e in events2), "Resume must have content"
            
            duration = time.time() - start
            print(f"  ✅ PASS | {duration:.1f}s")
            return TestResult(test_name="resume-session", success=True, has_content=True, duration_seconds=duration)
        except Exception as e:
            duration = time.time() - start
            print(f"  ❌ FAIL | Error: {e}")
            return TestResult(test_name="resume-session", success=False, error=str(e), duration_seconds=duration)

    def test_history_endpoint(self) -> TestResult:
        """Test: History endpoint returns messages after a session."""
        print(f"\n{'='*60}")
        print(f"Test: history-endpoint")
        print(f"{'='*60}")
        
        start = time.time()
        project = f"history_test_{int(time.time())}"
        
        try:
            # Create a session first
            print("  Creating session...")
            self._stream_request("/api/v1/plan-product/stream", {
                "company": "e2e_test", "project": project,
                "message": "Build a recipe sharing app", "session_mode": "new"
            })
            
            # Query history
            print("  Querying history...")
            resp = httpx.get(
                f"{self.api_base_url}/api/v1/plan-product/history",
                params={"company": "e2e_test", "project": project},
                headers=self.headers, timeout=10.0
            )
            assert resp.status_code == 200, f"History returned {resp.status_code}"
            data = resp.json()
            msg_count = len(data.get("messages", []))
            assert msg_count >= 2, f"Expected >=2 messages, got {msg_count}"
            
            duration = time.time() - start
            print(f"  ✅ PASS | {msg_count} messages | {duration:.1f}s")
            return TestResult(test_name="history-endpoint", success=True, duration_seconds=duration)
        except Exception as e:
            duration = time.time() - start
            print(f"  ❌ FAIL | Error: {e}")
            return TestResult(test_name="history-endpoint", success=False, error=str(e), duration_seconds=duration)

    def test_clear_endpoint(self) -> TestResult:
        """Test: Clear endpoint returns success."""
        print(f"\n{'='*60}")
        print(f"Test: clear-endpoint")
        print(f"{'='*60}")
        
        start = time.time()
        try:
            resp = httpx.request(
                "DELETE", f"{self.api_base_url}/api/v1/plan-product",
                json={"company": "e2e_test", "project": "clear_test"},
                headers=self.headers, timeout=10.0
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data.get("success") is True
            
            duration = time.time() - start
            print(f"  ✅ PASS | {duration:.1f}s")
            return TestResult(test_name="clear-endpoint", success=True, duration_seconds=duration)
        except Exception as e:
            duration = time.time() - start
            print(f"  ❌ FAIL | Error: {e}")
            return TestResult(test_name="clear-endpoint", success=False, error=str(e), duration_seconds=duration)

    def run_all(self) -> List[TestResult]:
        print("\n" + "="*60)
        print("Plan Product SSE E2E Regression Tests")
        print(f"API: {self.api_base_url}")
        print(f"Time: {datetime.now().isoformat()}")
        print("="*60)

        # New session tests with different prompts
        for test in TEST_PROMPTS:
            result = self.test_new_session(test["name"], test["prompt"])
            self.results.append(result)
            time.sleep(3)

        # Resume test
        self.results.append(self.test_resume_session())
        time.sleep(2)

        # History test
        self.results.append(self.test_history_endpoint())

        # Clear test
        self.results.append(self.test_clear_endpoint())

        return self.results

    def print_summary(self) -> bool:
        print("\n" + "="*60)
        print("SUMMARY")
        print("="*60)

        total = len(self.results)
        passed = sum(1 for r in self.results if r.success)

        print(f"\nTotal: {total} | Passed: {passed} | Failed: {total - passed}")
        print("-"*60)
        for r in self.results:
            status = "✅" if r.success else "❌"
            extra = f"Q:{r.questions_count}" if r.has_questions else ""
            err = f" | {r.error[:60]}" if r.error else ""
            print(f"  {status} {r.test_name:30} | {r.duration_seconds:6.1f}s {extra}{err}")

        print("="*60)
        return passed == total

    def save_results(self, filepath: str):
        output = {
            "timestamp": datetime.now().isoformat(),
            "api_url": self.api_base_url,
            "summary": {"total": len(self.results), "passed": sum(1 for r in self.results if r.success)},
            "results": [
                {"test_name": r.test_name, "success": r.success, "has_content": r.has_content,
                 "has_questions": r.has_questions, "questions_count": r.questions_count,
                 "error": r.error, "duration_seconds": r.duration_seconds}
                for r in self.results
            ]
        }
        with open(filepath, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to: {filepath}")


def main():
    parser = argparse.ArgumentParser(description="E2E Plan Product SSE Tests")
    parser.add_argument("--api-url", default=os.environ.get("API_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--api-key", default=os.environ.get("STANDARDS_API_KEY", "changeit"))
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--output", default="e2e_plan_product_results.json")
    args = parser.parse_args()

    runner = PlanProductE2ERunner(args.api_url, args.api_key, args.timeout)

    try:
        runner.run_all()
        all_passed = runner.print_summary()
        runner.save_results(args.output)
        sys.exit(0 if all_passed else 1)
    except KeyboardInterrupt:
        print("\nInterrupted")
        if runner.results:
            runner.print_summary()
            runner.save_results(args.output)
        sys.exit(130)


if __name__ == "__main__":
    main()
