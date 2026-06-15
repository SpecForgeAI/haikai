"""Agentic endpoint discovery.

The LLM agent has tool access to the full structural store
(_calls.txt, _index.txt, _imports.txt, _inheritance.txt)
and source files. It uses its framework knowledge to identify
endpoints by reading and interpreting code — no hard-coded
framework patterns.

Strategy is defined in the Haikai skill file:
  haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md

Tool calling mode is selected automatically:
  - OpenAI/GPT: text-based TOOL_CALL: syntax
  - Claude (custom/anthropic provider): native function calling
"""
import json
import logging
from pathlib import Path
from typing import Optional

from src.ast.models import EndpointInfo
from src.ast.enrichment_tools import TOOLS
from src.ast.discovery_loop import run_discovery_loop

logger = logging.getLogger(__name__)

MAX_AGENT_TURNS = 60  # large codebases need many turns for incremental discovery
SKILL_FILE = Path(__file__).parent.parent.parent / "haikai-profiles" / "default" / "commands" / "discover-endpoints" / "single-agent" / "discover-endpoints.md"
CLI_SKILL_FILE = Path(__file__).parent.parent.parent / "haikai-profiles" / "default" / "commands" / "discover-endpoints" / "cli-agent" / "discover-endpoints.md"
ADAPTIVE_SKILL_FILE = Path(__file__).parent.parent.parent / "haikai-profiles" / "default" / "commands" / "discover-endpoints" / "single-agent" / "adaptive.md"


MINI_ADDENDUM = """
## CRITICAL INSTRUCTIONS (small model)

You MUST follow these rules exactly:

1. Do NOT stop early. Keep calling tools until you have found ALL endpoints.
2. Do NOT answer from memory. Every endpoint you report MUST come from a tool call.
3. Your FIRST tool call MUST be a grep for route patterns. Pick the right file glob for the language:
   - TypeScript/JS: file_glob="**/*.ts" or "**/*.js"
   - Java: file_glob="**/*.java"
   - Python: file_glob="**/*.py"
   - Ruby: file_glob="**/*.rb"
   Example: TOOL_CALL: grep(pattern="@Get|@Post|@Put|@Delete|@RequestMapping", file_glob="**/*.ts")
   Use | for OR in regex. Do NOT use **/* (too broad, matches binaries).
4. Do NOT use read_directory repeatedly. Use grep to find routes, then read_source for details.
5. Do NOT confuse endpoint discovery with interaction discovery. You are finding API ROUTES, not database calls.
6. After reporting endpoints, VERIFY: grep for all route patterns and compare count to your reported count.
"""


def _load_system_prompt(model: str = "", provider: str = "") -> str:
    """Load the discovery strategy from the Haikai skill file.

    Selects the appropriate prompt based on provider + DISCOVERY_STRATEGY env:
    - provider='custom'                          → cli-agent prompt (Claude with own tools)
    - provider!=custom, DISCOVERY_STRATEGY unset → single-agent/discover-endpoints.md (parser-driven, default)
    - provider!=custom, DISCOVERY_STRATEGY=adaptive → single-agent/adaptive.md (tool-investigation flow)
    """
    import os as _os
    if provider == "custom":
        skill_file = CLI_SKILL_FILE
    elif _os.environ.get("DISCOVERY_STRATEGY", "").lower().strip() == "adaptive":
        skill_file = ADAPTIVE_SKILL_FILE
    else:
        skill_file = SKILL_FILE
    try:
        prompt = skill_file.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning(f"Skill file not found: {skill_file}, using fallback")
        prompt = (
            "You are discovering API endpoints in a codebase. "
            "Use tools to read structural store data and source code. "
            "Identify all endpoints. Respond with FINAL_ANSWER as JSON array."
        )

    return prompt


def _build_data_availability(snapshot_path: str) -> str:
    """Assess what structural data is available and inform the agent."""
    snapshot = Path(snapshot_path)
    parts = []
    for store_file, label in [
        ("_imports.txt", "imports"),
        ("_calls.txt", "call graph"),
        ("_index.txt", "symbol index"),
        ("_inheritance.txt", "inheritance"),
    ]:
        p = snapshot / store_file
        if p.exists():
            lines = [l for l in p.read_text(encoding="utf-8", errors="replace").splitlines()
                     if not l.startswith("#") and l.strip()]
            if lines:
                parts.append(f"  {label}: {len(lines)} entries")
            else:
                parts.append(f"  {label}: EMPTY (tree-sitter not available for this language)")
        else:
            parts.append(f"  {label}: not available")
    return "\n".join(parts)


def discover_endpoints(
    llm_client,
    project_root: str = ".",
    snapshot_path: str = None,
) -> list[EndpointInfo]:
    """Discover endpoints using an agentic LLM with structural store tools.

    The LLM reads the structural store (imports, calls, index) and source
    files to identify endpoints using its framework knowledge. No hard-coded
    pattern matching — the LLM interprets the code.

    Args:
        llm_client: LLM client for agent interaction.
        project_root: Root path for source file reading.
        snapshot_path: Path to structural store snapshot.

    Returns:
        List of discovered EndpointInfo objects.
    """
    if not llm_client:
        logger.info("No LLM client — skipping endpoint discovery")
        return []

    if not snapshot_path:
        logger.warning("No snapshot path — endpoint discovery requires structural store")
        return []

    availability = _build_data_availability(snapshot_path)
    provider = getattr(llm_client, "provider", "openai")

    if provider == "custom":
        # CLI-delegated: Claude has its own tools, just tell it where to look
        # Use a deterministic output file path so Claude can write large
        # results without hitting the response token limit.
        log_dir = getattr(llm_client, "log_dir", None)
        if log_dir:
            output_file = str(Path(log_dir) / "claude_endpoints.json").replace("\\", "/")
        else:
            import tempfile
            output_file = str(Path(tempfile.gettempdir()) / "claude_endpoints.json").replace("\\", "/")

        user_msg = (
            f"The codebase is at: {project_root}\n\n"
            f"Structural data available at {snapshot_path}:\n{availability}\n\n"
            "Discover ALL API endpoints in this codebase. Use your tools (Read, Bash, Grep, Glob) "
            "to investigate the code. Read route files, controllers, and framework configs. "
            "Be exhaustive — find every endpoint.\n\n"
            f"WRITE THE COMPLETE RESULT AS A JSON ARRAY TO THIS FILE: {output_file}\n"
            f"Then respond with: FINAL_ANSWER {{\"file\": \"{output_file}\", \"count\": N}}\n"
            "Do NOT include the endpoints in your text response — only the file path and count.\n"
            "This bypasses the response token limit for large codebases."
        )
    else:
        # Read structural store samples so the model can detect the framework
        from .enrichment_tools import read_imports, read_index
        top_imports = read_imports(snapshot_path, "", limit=30)
        route_symbols = read_index(snapshot_path, "controller", limit=20)
        if route_symbols and "no symbols" in route_symbols:
            route_symbols = read_index(snapshot_path, "route", limit=20)
        if route_symbols and "no symbols" in route_symbols:
            route_symbols = read_index(snapshot_path, "endpoint", limit=20)

        framework_hints = ""
        if top_imports and "no imports" not in top_imports and "EMPTY" not in top_imports:
            framework_hints += f"\nTop imports (use these to identify the framework):\n{top_imports}\n"
        if route_symbols and "no symbols" not in route_symbols:
            framework_hints += f"\nRoute-related symbols:\n{route_symbols}\n"

        user_msg = (
            f"Data availability for this codebase:\n{availability}\n"
            f"{framework_hints}\n"
            "Discover all API endpoints in this codebase. "
            "Use the imports and symbols above to identify the framework BEFORE writing your parser."
        )

    model = getattr(llm_client, "model", "")
    provider = getattr(llm_client, "provider", "openai")

    messages = [
        {"role": "system", "content": _load_system_prompt(model, provider)},
        {"role": "user", "content": user_msg},
    ]

    endpoints = run_discovery_loop(
        llm_client=llm_client,
        messages=messages,
        max_turns=MAX_AGENT_TURNS,
        project_root=project_root,
        snapshot_path=snapshot_path,
        parse_answer_fn=_parse_endpoint_answer,
        parse_bare_json_fn=_parse_bare_json,
        discovery_name="endpoint",
    )

    return endpoints




def _items_to_endpoints(items: list) -> list[EndpointInfo]:
    """Convert raw dict list to EndpointInfo list."""
    return [
        EndpointInfo(
            type=item.get("type", "REST"),
            path=item.get("path", ""),
            operation=item.get("operation", "DYNAMIC"),
            handler_class=item.get("handler_class", "") or "",
            handler_method=item.get("handler_method", ""),
            file=item.get("file", ""),
            line=item.get("line", 0),
            direction=item.get("direction", "INBOUND"),
            protocol=item.get("protocol", "HTTP"),
            framework=item.get("framework", ""),
            confidence=item.get("confidence", 0.80),
        )
        for item in items if isinstance(item, dict)
    ]


def _try_load_from_file(text: str) -> Optional[list[EndpointInfo]]:
    """If text contains a JSON object with 'file' key, load endpoints from that file."""
    import re
    # Look for {"file": "...", "count": N} pattern
    match = re.search(r'\{[^{}]*"file"\s*:\s*"([^"]+)"[^{}]*\}', text)
    if not match:
        return None
    file_path = match.group(1)
    try:
        from pathlib import Path
        p = Path(file_path)
        if not p.exists():
            logger.warning(f"Claude reported file {file_path} but it doesn't exist")
            return None
        # Read with utf-8-sig so a leading BOM (Claude CLI sometimes writes
        # one on Windows) doesn't blow up json.loads. utf-8-sig accepts files
        # both with and without a BOM, so this is strictly more permissive
        # than utf-8.
        raw = p.read_text(encoding="utf-8-sig", errors="replace")
        if not raw.strip():
            logger.warning(f"File {file_path} is empty")
            return None
        data = json.loads(raw)
        if not isinstance(data, list):
            logger.warning(f"File {file_path} doesn't contain a JSON array")
            return None
        endpoints = _items_to_endpoints(data)
        logger.info(f"Loaded {len(endpoints)} endpoints from file: {file_path}")
        return endpoints
    except Exception as e:
        logger.warning(f"Failed to load endpoints from {file_path}: {e}")
        return None


def _parse_bare_json(response: str) -> list[EndpointInfo]:
    """Parse a bare JSON array (no FINAL_ANSWER prefix) into EndpointInfo list."""
    # First try: file-path response
    from_file = _try_load_from_file(response)
    if from_file is not None:
        return from_file

    try:
        results = json.loads(response)
        if not isinstance(results, list) or not results:
            return []
        # Validate it looks like endpoint data (not tool results or other JSON)
        if not isinstance(results[0], dict) or "type" not in results[0]:
            return []
        return _items_to_endpoints(results)
    except (json.JSONDecodeError, ValueError):
        return []


def _parse_endpoint_answer(response: str) -> list[EndpointInfo]:
    """Parse FINAL_ANSWER JSON into EndpointInfo list."""
    idx = response.index("FINAL_ANSWER")
    json_str = response[idx + len("FINAL_ANSWER"):].strip().lstrip(":").strip()

    # First try: file-path response (e.g. FINAL_ANSWER {"file": "...", "count": N})
    from_file = _try_load_from_file(json_str)
    if from_file is not None:
        return from_file

    # Strip markdown fences
    if "```" in json_str:
        lines = json_str.splitlines()
        lines = [l for l in lines if not l.strip().startswith("```")]
        json_str = "\n".join(lines).strip()

    bracket_start = json_str.find("[")
    bracket_end = json_str.rfind("]")
    if bracket_start < 0 or bracket_end <= bracket_start:
        logger.warning("No JSON array found in FINAL_ANSWER")
        return []

    json_str = json_str[bracket_start:bracket_end + 1]

    try:
        results = json.loads(json_str)
        if not isinstance(results, list):
            return []

        endpoints = []
        for item in results:
            if not isinstance(item, dict):
                continue
            endpoints.append(EndpointInfo(
                type=item.get("type", "REST"),
                path=item.get("path", ""),
                operation=item.get("operation", "DYNAMIC"),
                handler_class=item.get("handler_class", ""),
                handler_method=item.get("handler_method", ""),
                file=item.get("file", ""),
                line=item.get("line", 0),
                direction=item.get("direction", "INBOUND"),
                protocol=item.get("protocol", "HTTP"),
                framework=item.get("framework", ""),
                confidence=item.get("confidence", 0.80),
            ))
        return endpoints

    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse endpoint FINAL_ANSWER: {e}")
        return []
