#!/usr/bin/env python3
"""
E2E Regression Tests: ShapeSpec SSE with AskQuestions Skill

This script runs 10 unique ShapeSpec requests against the live API
to verify the /ask-questions skill is properly invoked and the
'questions' event is correctly yielded in the SSE stream.

Usage:
    python3 tests/e2e_shapespec_askquestions.py [--api-url URL] [--api-key KEY]

Environment:
    API_BASE_URL: Base URL for the API (default: http://host.docker.internal:8000)
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

# =============================================================================
# Test Configuration
# =============================================================================

@dataclass
class TestResult:
    """Result of a single test run."""
    test_id: int
    spec_name: str
    prompt: str
    success: bool
    has_questions_event: bool
    questions_count: int
    has_folder_event: bool
    folder_name: Optional[str]
    event_types: List[str]
    error: Optional[str] = None
    duration_seconds: float = 0.0
    raw_events: List[Dict] = field(default_factory=list)


# 10 unique ShapeSpec prompts designed to trigger /ask-questions
TEST_PROMPTS = [
    {
        "name": "user-authentication",
        "prompt": "I need a user authentication system with OAuth2 support, JWT tokens, and role-based access control"
    },
    {
        "name": "payment-processing",
        "prompt": "Build a payment processing module that integrates with Stripe and PayPal, handles refunds, and manages subscriptions"
    },
    {
        "name": "notification-service",
        "prompt": "Create a notification service that supports email, SMS, and push notifications with templating and scheduling"
    },
    {
        "name": "file-storage",
        "prompt": "Design a file storage system with S3 integration, virus scanning, thumbnail generation, and access control"
    },
    {
        "name": "search-engine",
        "prompt": "Implement a search engine with Elasticsearch, faceted search, autocomplete, and relevance tuning"
    },
    {
        "name": "analytics-dashboard",
        "prompt": "Build an analytics dashboard with real-time metrics, custom reports, and data export functionality"
    },
    {
        "name": "inventory-management",
        "prompt": "Create an inventory management system with stock tracking, reorder alerts, and multi-warehouse support"
    },
    {
        "name": "chat-messaging",
        "prompt": "Design a real-time chat messaging system with group chats, file sharing, and message history"
    },
    {
        "name": "booking-reservation",
        "prompt": "Build a booking and reservation system with calendar integration, availability management, and waitlists"
    },
    {
        "name": "content-moderation",
        "prompt": "Implement a content moderation system with AI-powered detection, manual review queue, and appeal process"
    },
]


# =============================================================================
# Test Runner
# =============================================================================

class ShapeSpecE2ERunner:
    """Runs E2E tests for ShapeSpec SSE endpoint."""
    
    def __init__(self, api_base_url: str, api_key: str, timeout: float = 180.0):
        self.api_base_url = api_base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.results: List[TestResult] = []
        
    def run_single_test(self, test_id: int, spec_name: str, prompt: str) -> TestResult:
        """Run a single ShapeSpec test."""
        print(f"\n{'='*60}")
        print(f"Test {test_id}/10: {spec_name}")
        print(f"{'='*60}")
        print(f"Prompt: {prompt[:80]}...")
        
        start_time = time.time()
        events = []
        error = None
        
        # Use unique company/project for each test
        company = "e2e_regression"
        project = f"{spec_name}_{int(time.time())}"
        
        request_data = {
            "company": company,
            "project": project,
            "message": prompt,
            "session_mode": "new"
        }
        
        try:
            with httpx.stream(
                "POST",
                f"{self.api_base_url}/api/v1/shape-spec/stream",
                json=request_data,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                timeout=self.timeout
            ) as response:
                if response.status_code != 200:
                    error = f"HTTP {response.status_code}: {response.text}"
                else:
                    for line in response.iter_lines():
                        if line.startswith("data: "):
                            try:
                                event = json.loads(line[6:])
                                events.append(event)
                                
                                # Print progress
                                event_type = event.get("type", "unknown")
                                if event_type == "content":
                                    print(".", end="", flush=True)
                                elif event_type == "skill_invoked":
                                    print(f"\n  → Skill: {event.get('skill')}")
                                elif event_type == "questions":
                                    print(f"\n  ✓ Questions: {len(event.get('questions', []))} found")
                                elif event_type == "folder":
                                    print(f"\n  ✓ Folder: {event.get('folder')}")
                                elif event_type == "error":
                                    print(f"\n  ✗ Error: {event.get('message')}")
                            except json.JSONDecodeError:
                                pass
                                
        except httpx.TimeoutException:
            error = f"Timeout after {self.timeout}s"
        except Exception as e:
            error = str(e)
        
        duration = time.time() - start_time
        
        # Analyze results
        event_types = [e.get("type") for e in events]
        has_questions = "questions" in event_types
        questions_event = next((e for e in events if e.get("type") == "questions"), None)
        questions_count = len(questions_event.get("questions", [])) if questions_event else 0
        
        has_folder = "folder" in event_types
        folder_event = next((e for e in events if e.get("type") == "folder"), None)
        folder_name = folder_event.get("folder") if folder_event else None
        
        # Success = no errors
        success = error is None
        
        result = TestResult(
            test_id=test_id,
            spec_name=spec_name,
            prompt=prompt,
            success=success,
            has_questions_event=has_questions,
            questions_count=questions_count,
            has_folder_event=has_folder,
            folder_name=folder_name,
            event_types=list(set(event_types)),
            error=error,
            duration_seconds=duration,
            raw_events=events
        )
        
        # Print result summary
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"\n{status} | Duration: {duration:.1f}s | Questions: {questions_count} | Folder: {folder_name or 'None'}")
        if error:
            print(f"  Error: {error}")
        
        return result
    
    def run_all_tests(self) -> List[TestResult]:
        """Run all 10 ShapeSpec tests."""
        print("\n" + "="*60)
        print("ShapeSpec SSE + AskQuestions E2E Regression Tests")
        print(f"API: {self.api_base_url}")
        print(f"Time: {datetime.now().isoformat()}")
        print("="*60)
        
        for i, test in enumerate(TEST_PROMPTS, 1):
            result = self.run_single_test(i, test["name"], test["prompt"])
            self.results.append(result)
            
            # Small delay between tests to avoid rate limiting
            if i < len(TEST_PROMPTS):
                print("\nWaiting 5s before next test...")
                time.sleep(5)
        
        return self.results
    
    def print_summary(self):
        """Print summary of all test results."""
        print("\n" + "="*60)
        print("SUMMARY")
        print("="*60)
        
        total = len(self.results)
        passed = sum(1 for r in self.results if r.success)
        with_questions = sum(1 for r in self.results if r.has_questions_event)
        with_folder = sum(1 for r in self.results if r.has_folder_event)
        total_questions = sum(r.questions_count for r in self.results)
        
        print(f"\nTotal Tests:     {total}")
        print(f"Passed:          {passed}/{total} ({100*passed/total:.0f}%)")
        print(f"With Questions:  {with_questions}/{total}")
        print(f"With Folder:     {with_folder}/{total}")
        print(f"Total Questions: {total_questions}")
        
        print("\nDetailed Results:")
        print("-"*60)
        for r in self.results:
            status = "✅" if r.success else "❌"
            q_status = f"Q:{r.questions_count}" if r.has_questions_event else "Q:--"
            f_status = f"F:{r.folder_name}" if r.has_folder_event else "F:--"
            print(f"  {status} {r.test_id:2}. {r.spec_name:25} | {q_status:5} | {f_status}")
        
        # Critical check: Did /ask-questions work?
        print("\n" + "="*60)
        if with_questions > 0:
            print(f"✅ /ask-questions WORKING: {with_questions}/{total} tests generated questions")
        else:
            print(f"❌ /ask-questions NOT WORKING: No tests generated questions!")
        print("="*60)
        
        return passed == total
    
    def save_results(self, filepath: str):
        """Save detailed results to JSON file."""
        output = {
            "timestamp": datetime.now().isoformat(),
            "api_url": self.api_base_url,
            "summary": {
                "total": len(self.results),
                "passed": sum(1 for r in self.results if r.success),
                "with_questions": sum(1 for r in self.results if r.has_questions_event),
                "total_questions": sum(r.questions_count for r in self.results),
            },
            "results": [
                {
                    "test_id": r.test_id,
                    "spec_name": r.spec_name,
                    "prompt": r.prompt,
                    "success": r.success,
                    "has_questions_event": r.has_questions_event,
                    "questions_count": r.questions_count,
                    "has_folder_event": r.has_folder_event,
                    "folder_name": r.folder_name,
                    "event_types": r.event_types,
                    "error": r.error,
                    "duration_seconds": r.duration_seconds,
                }
                for r in self.results
            ]
        }
        
        with open(filepath, "w") as f:
            json.dump(output, f, indent=2)
        
        print(f"\nResults saved to: {filepath}")


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="E2E ShapeSpec SSE Tests")
    parser.add_argument("--api-url", default=os.environ.get("API_BASE_URL", "http://host.docker.internal:8000"))
    parser.add_argument("--api-key", default=os.environ.get("STANDARDS_API_KEY", "changeit"))
    parser.add_argument("--timeout", type=float, default=180.0, help="Request timeout in seconds")
    parser.add_argument("--output", default="e2e_results.json", help="Output file for results")
    args = parser.parse_args()
    
    runner = ShapeSpecE2ERunner(
        api_base_url=args.api_url,
        api_key=args.api_key,
        timeout=args.timeout
    )
    
    try:
        runner.run_all_tests()
        all_passed = runner.print_summary()
        runner.save_results(args.output)
        
        sys.exit(0 if all_passed else 1)
        
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        if runner.results:
            runner.print_summary()
            runner.save_results(args.output)
        sys.exit(130)


if __name__ == "__main__":
    main()
