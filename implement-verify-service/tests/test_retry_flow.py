"""
Test script for the shape-spec /ask-questions retry flow.

Tests the full retry mechanism by hitting the SSE endpoint and printing
each event as it arrives. Shows retry, retry_progress, and questions_failed
events in real time.

SETUP:
  1. Add the debug override to force retries (see instructions below)
  2. Start the API server
  3. Run: python test_retry_flow.py

DEBUG OVERRIDE (required to force the failure path):
  In src/chat/claude_chat_executor.py, add these 3 lines at line 586
  (right before the "# Retry if new session" comment):

      # DEBUG: Force retry path — REMOVE AFTER TESTING
      if is_new_session:
          is_collecting_questions = False
          ask_questions_content = []

  This forces the retry loop to trigger regardless of whether the LLM
  actually invoked /ask-questions.

  TIP: Set MAX_ASK_QUESTIONS_RETRIES = 1 (line 590) for faster testing.
"""

import json
import sys
import os
import requests

# --------------------------------------------------------------------------
# Configuration — adjust these to match your environment
# --------------------------------------------------------------------------
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8004")
API_KEY = os.getenv("STANDARDS_API_KEY", "changeit")
COMPANY = "test-company"
PROJECT = "test-project"
MESSAGE = "I want to build a user authentication system"


def test_retry_flow():
    """Hit the shape-spec SSE endpoint and print every event."""

    url = f"{API_BASE_URL}/api/v1/shape-spec/stream"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    payload = {
        "company": COMPANY,
        "project": PROJECT,
        "message": MESSAGE,
        "session_mode": "new",
    }

    print(f"POST {url}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    print("-" * 70)
    print()

    try:
        with requests.post(url, json=payload, headers=headers, stream=True, timeout=300) as resp:
            if resp.status_code != 200:
                print(f"ERROR: HTTP {resp.status_code}")
                print(resp.text)
                return

            event_count = 0
            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue

                # SSE lines are prefixed with "data: "
                if line.startswith("data: "):
                    raw = line[6:]
                    event_count += 1

                    try:
                        event = json.loads(raw)
                        event_type = event.get("type", "unknown")

                        # Color-code by event type for readability
                        label = format_event_label(event_type)
                        detail = format_event_detail(event)

                        print(f"  [{event_count:03d}] {label}  {detail}")

                    except json.JSONDecodeError:
                        print(f"  [{event_count:03d}] RAW  {raw[:120]}")

            print()
            print("-" * 70)
            print(f"Stream ended. Total events received: {event_count}")

    except requests.exceptions.ConnectionError:
        print(f"ERROR: Could not connect to {API_BASE_URL}")
        print("Make sure the API server is running.")
    except KeyboardInterrupt:
        print("\nInterrupted by user.")


def format_event_label(event_type: str) -> str:
    """Format event type as a fixed-width label."""
    labels = {
        "content":          "CONTENT          ",
        "retry":            ">> RETRY         ",
        "retry_progress":   ">> RETRY_PROGRESS",
        "questions":        "** QUESTIONS     ",
        "questions_failed": "!! FAILED        ",
        "folder":           "FOLDER           ",
        "error":            "ERROR            ",
        "skill_invoked":    "SKILL            ",
        "file_modified":    "FILE             ",
        "warning":          "WARNING          ",
    }
    return labels.get(event_type, f"{event_type:<17}")


def format_event_detail(event: dict) -> str:
    """Extract the most useful detail from an event."""
    event_type = event.get("type", "")

    if event_type == "content":
        delta = event.get("delta", "")
        # Truncate long content
        if len(delta) > 80:
            return f'"{delta[:80]}..."'
        return f'"{delta}"'

    if event_type == "retry":
        return f'{event.get("message", "")} (attempt {event.get("attempt")}/{event.get("max_attempts")})'

    if event_type == "retry_progress":
        return f'[{event.get("step", "")}] {event.get("message", "")}'

    if event_type == "questions":
        questions = event.get("questions", [])
        return f"{len(questions)} question(s)"

    if event_type == "questions_failed":
        return event.get("message", "")

    if event_type == "folder":
        return event.get("folder", "")

    if event_type == "error":
        return event.get("message", "")[:100]

    if event_type == "skill_invoked":
        return event.get("skill", "")

    if event_type == "file_modified":
        return event.get("path", "")

    # Fallback: dump the whole event
    return json.dumps(event)


if __name__ == "__main__":
    test_retry_flow()
