"""LLM agent for classifying external interactions.

Takes a batch of unclassified calls (grouped by framework) and uses an LLM
to determine which are external interactions and classify them.
Supports iterative source enrichment — the agent can request source code
for ambiguous calls.
"""
import json
import logging
from pathlib import Path
from typing import Optional

from src.ast.models import InteractionInfo
from src.ast.interaction_classifier import FrameworkBatch, UnclassifiedCall

logger = logging.getLogger(__name__)

MAX_PASSES = 3
MAX_CALLS_PER_BATCH = 100  # Limit calls sent to LLM per request


SYSTEM_PROMPT = """You are classifying code interactions in a software application.

You will receive a list of call sites detected by static analysis. For each call, determine:

1. Is this an EXTERNAL interaction (crosses a system boundary — HTTP, database, message queue, cache, filesystem, gRPC, email, event bus, websocket, etc.) or INTERNAL (application logic, utility, framework plumbing)?

2. If EXTERNAL, classify it with:
   - type: HTTP_SERVICE, DATABASE, MESSAGE_QUEUE, CACHE, FILE_SYSTEM, GRPC_SERVICE, EMAIL, EVENT_BUS, WEBSOCKET, GRAPHQL_SERVICE, ASYNC_JOB
   - direction: READ, WRITE, PUBLISH, SUBSCRIBE, REQUEST_RESPONSE
   - mechanism: the library/framework name (e.g., RestTemplate, JPA, Celery, fetch)
   - target: what's being called (URL, table, topic, file path) — use "" if unknown
   - data_entity: what data type is flowing — use "" if unknown

Respond with a JSON array. For INTERNAL calls, omit them from the response.
Only include EXTERNAL interactions."""


def build_user_prompt(batch: FrameworkBatch) -> str:
    """Build the user prompt for a framework batch."""
    lines = [
        f"Language: {batch.language}",
        f"Framework: {batch.framework} ({batch.category})",
        f"Framework imports in this repo: {', '.join(batch.imports[:10])}",
        "",
        "Call sites (tab-separated: caller_file | caller | callee | line):",
    ]

    for uc in batch.calls[:MAX_CALLS_PER_BATCH]:
        c = uc.call
        lines.append(f"{c.caller_file}\t{c.caller_name}\t{c.callee_name}\t{c.line}")

    lines.append("")
    lines.append("Respond with a JSON array of external interactions only.")
    lines.append('Example: [{"caller_file": "Service.java", "caller_name": "Service.send", '
                 '"callee_name": "kafkaTemplate.send", "line": 42, '
                 '"type": "MESSAGE_QUEUE", "direction": "PUBLISH", '
                 '"mechanism": "KafkaTemplate", "target": "order-events", '
                 '"data_entity": "OrderEvent"}]')

    return "\n".join(lines)


def build_enrichment_prompt(ambiguous_calls: list[dict], source_snippets: dict[str, str]) -> str:
    """Build a follow-up prompt with source code for ambiguous calls."""
    lines = [
        "Some calls were ambiguous. Here is the source code around each call site.",
        "Please reclassify these with the additional context.",
        "",
    ]

    for call in ambiguous_calls:
        file_path = call.get("caller_file", "")
        line = call.get("line", 0)
        snippet = source_snippets.get(f"{file_path}:{line}", "")
        lines.append(f"--- {file_path}:{line} ---")
        lines.append(snippet)
        lines.append("")

    lines.append("Respond with the same JSON array format.")
    return "\n".join(lines)


def _llm_generate_json(llm_client, system_prompt: str, user_prompt: str) -> list | dict:
    """Call LLM and parse JSON, handling markdown code fences."""
    try:
        return llm_client.generate_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=4000,
        )
    except Exception:
        # Fallback: try generate() and strip markdown fences manually
        raw = llm_client.generate(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=4000,
        )
        # Strip markdown code fences
        text = raw.strip()
        if text.startswith("```"):
            lines = text.splitlines()
            # Remove first line (```json) and last line (```)
            lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(lines).strip()
        return json.loads(text)


def classify_batch(
    batch: FrameworkBatch,
    llm_client,
    project_root: str = ".",
) -> list[InteractionInfo]:
    """Classify a batch of unclassified calls using the LLM.

    Args:
        batch: Framework batch with unclassified calls
        llm_client: LLMClient instance (Anthropic/OpenAI/Azure)
        project_root: Root path for reading source files

    Returns:
        List of InteractionInfo for calls classified as external.
    """
    if not batch.calls:
        return []

    # Build lookup: (file, line) → original call site for joining AST data with LLM output
    call_lookup: dict[tuple[str, int], UnclassifiedCall] = {}
    for uc in batch.calls[:MAX_CALLS_PER_BATCH]:
        call_lookup[(uc.call.caller_file, uc.call.line)] = uc

    # Pass 1: Send call sites to LLM
    user_prompt = build_user_prompt(batch)

    try:
        response = _llm_generate_json(llm_client, SYSTEM_PROMPT, user_prompt)
    except Exception as e:
        logger.error(f"LLM classification failed for {batch.framework}: {e}")
        return []

    # Parse response
    interactions = []
    ambiguous = []

    if isinstance(response, list):
        items = response
    elif isinstance(response, dict) and "interactions" in response:
        items = response["interactions"]
    else:
        items = []

    for item in items:
        if not isinstance(item, dict):
            continue

        # Check if the LLM flagged it as ambiguous
        if item.get("ambiguous") or item.get("needs_source"):
            ambiguous.append(item)
            continue

        interaction = _parse_llm_interaction(item, batch, call_lookup)
        if interaction:
            interactions.append(interaction)

    # Pass 2+: Source enrichment for ambiguous calls
    pass_count = 1
    while ambiguous and pass_count < MAX_PASSES:
        pass_count += 1
        logger.info(f"LLM pass {pass_count} for {batch.framework}: {len(ambiguous)} ambiguous calls")

        # Read source snippets
        snippets = {}
        for call in ambiguous:
            file_path = call.get("caller_file", "")
            line = call.get("line", 0)
            snippet = _read_source_snippet(file_path, line, project_root)
            if snippet:
                snippets[f"{file_path}:{line}"] = snippet

        if not snippets:
            break

        enrichment_prompt = build_enrichment_prompt(ambiguous, snippets)

        try:
            response = _llm_generate_json(llm_client, SYSTEM_PROMPT, enrichment_prompt)
        except Exception as e:
            logger.error(f"LLM enrichment pass {pass_count} failed: {e}")
            break

        # Parse enrichment response
        new_ambiguous = []
        enrichment_items = response if isinstance(response, list) else response.get("interactions", [])

        for item in enrichment_items:
            if not isinstance(item, dict):
                continue
            if item.get("ambiguous") or item.get("needs_source"):
                new_ambiguous.append(item)
                continue
            interaction = _parse_llm_interaction(item, batch, call_lookup)
            if interaction:
                interactions.append(interaction)

        ambiguous = new_ambiguous

    logger.info(
        f"LLM classified {batch.framework}: {len(interactions)} interactions "
        f"in {pass_count} pass(es), {len(ambiguous)} still ambiguous"
    )

    return interactions


def _parse_llm_interaction(
    item: dict,
    batch: FrameworkBatch,
    call_lookup: dict[tuple[str, int], UnclassifiedCall] = None,
) -> Optional[InteractionInfo]:
    """Parse a single LLM response item into an InteractionInfo.

    Joins LLM classification (type, direction, mechanism) with original
    AST call site data (receiver, method, file, line) via call_lookup.
    """
    interaction_type = item.get("type", "")
    if not interaction_type:
        return None

    caller = item.get("caller_name", "")
    parts = caller.rsplit(".", 1)
    file_path = item.get("caller_file", "")
    line = item.get("line", 0)

    # Join with original call site to get receiver.method (AST data)
    target = item.get("target", "")
    if not target and call_lookup:
        uc = call_lookup.get((file_path, line))
        if uc:
            # Use the AST's callee_name as target (e.g., "kafkaProducer.send")
            target = uc.call.callee_name

    return InteractionInfo(
        source_class=parts[0] if len(parts) > 1 else "",
        source_method=parts[-1] if parts else "",
        target=target,
        target_type=interaction_type,
        direction=item.get("direction", "REQUEST_RESPONSE"),
        mechanism=item.get("mechanism", batch.framework),
        data_hint=item.get("data_entity", ""),
        file=file_path,
        line=line,
        confidence=0.75,
    )


def _read_source_snippet(
    file_path: str,
    line: int,
    project_root: str,
    context_lines: int = 10,
) -> str:
    """Read source code around a specific line.

    The read is scoped to `project_root` — absolute paths and `..` segments
    are rejected so an LLM-supplied `file_path` (from the agent's prior
    response, potentially under prompt injection from hostile repo content)
    can't escape the project tree. Returns empty string on rejection so
    callers (`build_enrichment_prompt`) handle it the same as a missing
    file. Same fix as `enrichment_tools.read_source` (commit 51603da).
    """
    if ".." in Path(file_path).parts:
        return ""
    candidate_path = Path(project_root) / file_path
    try:
        full_path = candidate_path.resolve()
        full_path.relative_to(Path(project_root).resolve())
    except (ValueError, OSError):
        return ""
    if not full_path.exists():
        return ""

    try:
        source_lines = full_path.read_text(encoding="utf-8", errors="replace").splitlines()
        start = max(0, line - context_lines - 1)
        end = min(len(source_lines), line + context_lines)
        snippet_lines = []
        for i in range(start, end):
            marker = ">>>" if i == line - 1 else "   "
            snippet_lines.append(f"{marker} {i + 1}: {source_lines[i]}")
        return "\n".join(snippet_lines)
    except Exception:
        return ""
