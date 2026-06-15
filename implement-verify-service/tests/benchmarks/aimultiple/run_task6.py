#!/usr/bin/env python3
"""
Run Task 6 (Helpdesk Ticket System) through the Standards Extractor API.
Mode A: Direct generation via /api/v1/shape-spec/stream
"""
import json
import sys
import re
import httpx
import time
from pathlib import Path

API_URL = "http://localhost:8000"
API_KEY = None  # Will read from .env

OUTPUT_DIR = Path(__file__).parent / "output" / "task-6" / f"run-{int(time.time())}"
TASK_SPEC = Path(__file__).parent / "tasks" / "task-6-web.md"


def read_api_key():
    """Read API key from .env file."""
    env_file = Path(__file__).parent.parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("STANDARDS_API_KEY="):
                return line.split("=", 1)[1].strip()
    return "changeit"


def send_to_shapespec(task_markdown: str, api_key: str) -> str:
    """Send task spec to shape-spec/stream and collect full response.
    
    NOTE: The shape-spec endpoint filters content events from SSE (by design).
    Content is streamed to server-side JSONL logs only. After the stream completes,
    we retrieve the full response from the conversation history endpoint or stream log.
    """
    company = "benchmark"
    project = "task-6-helpdesk"
    
    print(f"📤 Sending task spec to {API_URL}/api/v1/shape-spec/stream ...")
    
    payload = {
        "company": company,
        "project": project,
        "message": f"IMPORTANT: Skip specification discussion. Generate the COMPLETE, WORKING source code for every file listed below. Output each file as a markdown code block with the file path as a comment on the first line (e.g., `# backend/main.py`). Do NOT ask questions or describe architecture — just write all the code files.\n\n{task_markdown}",
        "session_mode": "new"
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    
    session_id = None
    
    # Stream the request (content is filtered server-side, we just wait for completion)
    with httpx.stream(
        "POST", f"{API_URL}/api/v1/shape-spec/stream",
        json=payload, headers=headers, timeout=300.0
    ) as response:
        print(f"   Status: {response.status_code}")
        if response.status_code != 200:
            print(f"   Error: {response.read().decode()}")
            sys.exit(1)
        
        for line in response.iter_lines():
            if not line.strip():
                continue
            data_str = line[6:] if line.startswith("data: ") else line
            if data_str == "[DONE]":
                break
            try:
                data = json.loads(data_str)
                msg_type = data.get("type", "")
                if msg_type == "session":
                    session_id = data.get("session_id", "")
                    print(f"   Session: {session_id}")
                elif msg_type == "error":
                    print(f"\n⚠️  Error: {data.get('message', '')}")
                elif msg_type == "questions":
                    print(f"\n📋 Questions generated: {len(data.get('questions', []))}")
                elif msg_type == "folder":
                    print(f"\n📂 Spec folder: {data.get('folder', '')}")
                else:
                    print(".", end="", flush=True)
            except json.JSONDecodeError:
                pass
    
    print(f"\n   Stream complete. Retrieving response from server logs...")
    
    # Retrieve the full response from the conversation history API
    full_response = ""
    try:
        hist_resp = httpx.get(
            f"{API_URL}/api/v1/shape-spec/history",
            params={"company": company, "project": project},
            headers=headers,
            timeout=30.0
        )
        if hist_resp.status_code == 200:
            history = hist_resp.json()
            messages = history.get("messages", history.get("conversation", []))
            # Get the last assistant message
            for msg in reversed(messages):
                if msg.get("role") == "assistant":
                    full_response = msg.get("content", "")
                    break
    except Exception as e:
        print(f"   ⚠️  History API failed: {e}")
    
    # Fallback: read from the stream JSONL log
    if not full_response:
        print("   Falling back to stream log files...")
        import glob
        log_pattern = f"/app/workspace/{company}/{project}/chat_logs/stream_*.jsonl"
        log_files = sorted(glob.glob(log_pattern))
        if log_files:
            latest_log = log_files[-1]
            with open(latest_log) as f:
                for line in f:
                    try:
                        event = json.loads(line.strip())
                        if event.get("type") == "content":
                            full_response += event.get("delta", "")
                    except:
                        pass
    
    print(f"\n📥 Received {len(full_response)} characters")
    return full_response


def extract_files(response: str) -> dict[str, str]:
    """Extract project files from LLM response."""
    files = {}
    
    # Strategy 1: ```language\n# filepath or // filepath
    # Matches code blocks with file path comments at the start
    blocks = re.findall(r'```(\w*)\n(.*?)```', response, re.DOTALL)
    
    for lang, content in blocks:
        content = content.strip()
        # Look for file path in first line
        first_line = content.split('\n')[0] if content else ""
        
        # Pattern: # backend/main.py or // frontend/src/App.jsx or /* filepath */
        path_match = re.match(r'^(?:#|//|/\*)\s*([\w./-]+\.\w+)', first_line)
        if path_match:
            filepath = path_match.group(1)
            # Remove the path comment line from content
            content = '\n'.join(content.split('\n')[1:])
            files[filepath] = content
            continue
        
        # Look for file path in text before the code block
        # Search backwards from block position for "File: path" or "### path" or "`path`"
    
    # Strategy 2: Scan for explicit file markers before code blocks
    # "**backend/main.py**" or "### backend/main.py" or "`backend/main.py`:" or "File: backend/main.py"
    pattern = r'(?:#+\s*|File:\s*|\*\*|`)((?:backend|frontend|project)[/\w.-]+\.\w+)(?:\*\*|`|:)?\s*\n+```\w*\n(.*?)```'
    for match in re.finditer(pattern, response, re.DOTALL):
        filepath = match.group(1).strip()
        content = match.group(2).strip()
        if filepath not in files:
            files[filepath] = content
    
    # Strategy 3: More aggressive - any recognizable path before a code block
    if len(files) < 3:
        pattern3 = r'((?:[\w-]+/)+[\w.-]+\.\w+)\s*(?::|\n)+\s*```\w*\n(.*?)```'
        for match in re.finditer(pattern3, response, re.DOTALL):
            filepath = match.group(1).strip()
            content = match.group(2).strip()
            if filepath not in files:
                files[filepath] = content
    
    return files


def write_project(files: dict[str, str], output_dir: Path):
    """Write extracted files to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for filepath, content in files.items():
        full_path = output_dir / filepath
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content)
        print(f"  📄 {filepath} ({len(content)} bytes)")


def main():
    api_key = read_api_key()
    
    # Read task spec
    task_markdown = TASK_SPEC.read_text()
    print(f"📋 Task spec: {TASK_SPEC} ({len(task_markdown)} chars)")
    
    # Send to API
    print()
    response = send_to_shapespec(task_markdown, api_key)
    
    # Save raw response
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "raw_response.md").write_text(response)
    print(f"\n💾 Raw response saved to {OUTPUT_DIR / 'raw_response.md'}")
    
    # Extract files
    print(f"\n🔍 Extracting project files...")
    files = extract_files(response)
    
    if not files:
        print("⚠️  No files extracted! The response may need manual parsing.")
        print(f"   Check {OUTPUT_DIR / 'raw_response.md'}")
        return 1
    
    print(f"\n📁 Extracted {len(files)} files:")
    write_project(files, OUTPUT_DIR / "project")
    
    print(f"\n✅ Project written to {OUTPUT_DIR / 'project'}")
    print(f"\nNext steps:")
    print(f"  1. cd {OUTPUT_DIR / 'project' / 'backend'}")
    print(f"  2. pip install -r requirements.txt")
    print(f"  3. uvicorn main:app --port 9000")
    print(f"  4. cd {OUTPUT_DIR / 'project' / 'frontend'} && npm install && npm run dev")
    print(f"  5. python smoke_runner.py ../tests/task-6.yaml --url http://localhost:9000")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
