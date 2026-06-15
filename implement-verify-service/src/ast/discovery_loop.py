"""Shared agentic discovery loop — three modes based on provider.

Text-based mode (OpenAI/GPT):
  LLM outputs ``TOOL_CALL: tool_name(param="value")`` as plain text.
  Python regex-parses and executes tools, sends results back.

CLI-delegated mode (Claude via proxy / ``custom`` provider):
  Each call to the proxy is a full Claude CLI session. Claude uses its
  own built-in tools (Read, Bash, Grep, Glob) to investigate the
  codebase. We only manage the high-level conversation: ask for
  endpoints, parse FINAL_ANSWER, ask for more.

Native tool use mode (direct Anthropic API):
  LLM returns structured tool_calls via the API.
  Python executes and sends tool results back as tool-result messages.

Provider detection is automatic.
"""
import json
import logging
from pathlib import Path
from typing import Callable, Optional

from .enrichment_tools import TOOLS, get_openai_tool_schemas

logger = logging.getLogger(__name__)

# Providers where the LLM has its own tool environment (e.g. Claude CLI via proxy).
# We don't manage tools — just send prompts and parse answers.
CLI_DELEGATED_PROVIDERS = {"custom"}

# Providers that support native structured tool calling via the API.
NATIVE_TOOL_PROVIDERS = {"anthropic"}


def _log_event(log_dir: Optional[Path], event: str, **data):
    """Append a structured event to events.jsonl (no truncation)."""
    if not log_dir:
        return
    from datetime import datetime, timezone
    record = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, **data}
    try:
        with open(log_dir / "events.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(record, default=str) + "\n")
    except Exception as e:
        logger.warning(f"Failed to log event {event}: {e}")


def _save_full_response(log_dir: Optional[Path], turn: int, response: str):
    """Save untruncated response text to log_dir/responses/."""
    if not log_dir:
        return
    out_dir = log_dir / "responses"
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with open(out_dir / f"turn_{turn:03d}.txt", "w", encoding="utf-8") as f:
            f.write(response)
    except Exception as e:
        logger.warning(f"Failed to save response for turn {turn}: {e}")


def _save_verification(log_dir: Optional[Path], turn: int, data: dict):
    """Save verification call details to log_dir/verifications/."""
    if not log_dir:
        return
    out_dir = log_dir / "verifications"
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with open(out_dir / f"after_turn_{turn:03d}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception as e:
        logger.warning(f"Failed to save verification for turn {turn}: {e}")


def run_discovery_loop(
    llm_client,
    messages: list[dict],
    max_turns: int,
    project_root: str,
    snapshot_path: str,
    parse_answer_fn: Callable[[str], list],
    parse_bare_json_fn: Callable[[str], list],
    discovery_name: str = "discovery",
) -> list:
    """Run the discovery loop, selecting mode based on provider.

    Args:
        llm_client: LLMClient instance.
        messages: Initial messages (system + user).
        max_turns: Maximum LLM turns.
        project_root: Root path for source reading tools.
        snapshot_path: Path to structural store snapshot.
        parse_answer_fn: Parses FINAL_ANSWER text into result list.
        parse_bare_json_fn: Parses bare JSON array into result list.
        discovery_name: Label for logging ("endpoint" or "interaction").

    Returns:
        List of discovered items (EndpointInfo or InteractionInfo).
    """
    provider = getattr(llm_client, "provider", "openai")
    log_dir = getattr(llm_client, "log_dir", None)
    _log_event(log_dir, "discovery_start",
               provider=provider, model=getattr(llm_client, "model", ""),
               project_root=project_root, snapshot_path=snapshot_path,
               max_turns=max_turns, discovery_name=discovery_name)

    if provider in CLI_DELEGATED_PROVIDERS:
        return _loop_cli_delegated(
            llm_client, messages, max_turns,
            project_root,
            parse_answer_fn, parse_bare_json_fn,
            discovery_name,
        )
    elif provider in NATIVE_TOOL_PROVIDERS:
        return _loop_native_tools(
            llm_client, messages, max_turns,
            project_root, snapshot_path,
            parse_answer_fn, parse_bare_json_fn,
            discovery_name,
        )
    else:
        return _loop_text_based(
            llm_client, messages, max_turns,
            project_root, snapshot_path,
            parse_answer_fn, parse_bare_json_fn,
            discovery_name,
        )


# ---------------------------------------------------------------------------
# CLI-delegated mode (Claude via proxy)
# ---------------------------------------------------------------------------

def _loop_cli_delegated(
    llm_client, messages, max_turns,
    project_root,
    parse_answer_fn, parse_bare_json_fn,
    discovery_name,
) -> list:
    """CLI-delegated mode: Claude CLI investigates with its own tools.

    Each call to the proxy spawns a Claude CLI session that uses Read, Bash,
    Grep, etc. internally. We just manage the high-level conversation:
    1. Ask Claude to find endpoints/interactions
    2. Parse FINAL_ANSWER from response
    3. Ask if there are more
    4. Repeat until done

    Fewer turns needed — each turn is a full multi-tool investigation.
    """
    results = []
    conversation_trace = []
    log_dir = getattr(llm_client, "log_dir", None)
    # CLI-delegated: allow a few turns for parser write → run → verify → fix cycle
    effective_max = min(max_turns, 5)

    # Reset per-discovery tool-call counter + shared trace
    TOOL_CALL_COUNTS.clear()
    from src.ast.observability import reset_trace, trace_event
    reset_trace(f"v1:{discovery_name}")
    trace_event("v1_run_start", discovery=discovery_name, max_turns=effective_max)

    for turn in range(effective_max):
        logger.info(f"=== {discovery_name} Turn {turn + 1}/{effective_max} (cli-delegated) ===")
        _log_event(log_dir, "turn_start", turn=turn + 1, mode="cli-delegated")
        try:
            response = llm_client.generate(messages=messages)
            if not isinstance(response, str):
                response = str(response)
        except Exception as e:
            logger.warning(f"{discovery_name} cli-delegated call failed on turn {turn + 1}: {e}")
            _log_event(log_dir, "turn_error", turn=turn + 1, error=str(e))
            if results:
                logger.info(f"Returning {len(results)} items discovered before failure")
            break

        logger.info(f"Response (turn {turn + 1}): {len(response)} chars")
        _save_full_response(log_dir, turn + 1, response)
        _log_event(log_dir, "response_received", turn=turn + 1, response_chars=len(response))
        conversation_trace.append({
            "turn": turn + 1,
            "response_length": len(response),
        })

        # Parse FINAL_ANSWER or bare JSON from the response.
        # CLI-delegated responses may contain MULTIPLE FINAL_ANSWER blocks
        # (Claude reports in batches within a single response).
        batch = []
        if "FINAL_ANSWER" in response:
            # Check for empty-only FINAL_ANSWER (done signal)
            clean_check = response.replace("FINAL_ANSWER []", "").replace("FINAL_ANSWER\n[]", "")
            if "FINAL_ANSWER" not in clean_check:
                logger.info(f"Empty FINAL_ANSWER on turn {turn + 1} — done")
                break

            # Split on FINAL_ANSWER and parse each block
            parts = response.split("FINAL_ANSWER")
            for part in parts[1:]:  # skip text before first FINAL_ANSWER
                part = part.strip()
                if part == "[]" or not part:
                    continue
                parsed = parse_answer_fn("FINAL_ANSWER " + part)
                if parsed:
                    batch.extend(parsed)
            logger.info(f"FINAL_ANSWER on turn {turn + 1}: {len(batch)} items from {len(parts) - 1} block(s)")
        else:
            # Try bare JSON
            stripped = response.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                batch = parse_bare_json_fn(stripped)
                if batch:
                    logger.info(f"Bare JSON on turn {turn + 1}: {len(batch)} items")

            # Also try to find JSON array anywhere in the response
            if not batch:
                import re
                json_match = re.search(r'\[[\s\S]*\]', response)
                if json_match:
                    try:
                        candidate = parse_bare_json_fn(json_match.group())
                        if candidate:
                            batch = candidate
                            logger.info(f"Extracted JSON from response on turn {turn + 1}: {len(batch)} items")
                    except Exception:
                        pass

        if batch:
            # Detect file-output mode: if response references a file path, replace
            # results with the batch (file is the canonical latest answer).
            # Otherwise accumulate (old inline-JSON mode).
            import re as _re
            is_file_response = bool(_re.search(r'"file"\s*:\s*"[^"]+"', response))
            if is_file_response:
                # Dedupe within batch only, REPLACE results
                seen = set()
                deduped = []
                for item in batch:
                    key = _item_key(item)
                    if key not in seen:
                        deduped.append(item)
                        seen.add(key)
                results.clear()
                results.extend(deduped)
                new_count = len(results)
                logger.info(f"File-output mode: replaced with {new_count} endpoints (turn {turn + 1})")
            else:
                # Inline JSON mode: deduplicate and accumulate across turns
                existing_keys = {_item_key(r) for r in results}
                new_count = 0
                for item in batch:
                    key = _item_key(item)
                    if key not in existing_keys:
                        results.append(item)
                        existing_keys.add(key)
                        new_count += 1
                logger.info(f"Accumulated: {new_count} new, {len(results)} total")
            _log_event(log_dir, "endpoints_accumulated", turn=turn + 1,
                       new_items=new_count, total=len(results),
                       mode="file" if is_file_response else "inline")
            conversation_trace.append({
                "turn": turn + 1, "new_items": new_count, "total": len(results)
            })

            # Verify against grep — accept or ask for refinement
            verify_msg = _verify_parser_output(
                project_root, results, parse_bare_json_fn
            )
            verify_decision = "mismatch" if verify_msg else "ok"
            _save_verification(log_dir, turn + 1, {
                "turn": turn + 1,
                "results_count": len(results),
                "decision": verify_decision,
                "feedback_to_llm": verify_msg,
            })
            _log_event(log_dir, "verification", turn=turn + 1,
                       decision=verify_decision, results_count=len(results))
            if verify_msg:
                logger.info(f"CLI-delegated verification: mismatch — asking for refinement")
                messages.append({"role": "assistant", "content": response})
                messages.append({"role": "user", "content": verify_msg})
                continue
            else:
                logger.info(f"CLI-delegated verification: OK — accepting {len(results)} endpoints")
                break
        else:
            # No parseable results — the response is just investigation text
            # or Claude couldn't find anything. Ask it to report.
            logger.info(f"No parseable results on turn {turn + 1}, asking for report")
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": (
                "Please provide your findings as a FINAL_ANSWER JSON array now. "
                "If you haven't found any endpoints/interactions, respond with: FINAL_ANSWER []"
            )})

    _save_trace(conversation_trace, llm_client, discovery_name)

    if not results:
        logger.warning(f"{discovery_name} cli-delegated: no results after {turn + 1} turns")

    # Tool-call breakdown (tracing)
    if TOOL_CALL_COUNTS:
        ranked = sorted(TOOL_CALL_COUNTS.items(), key=lambda x: -x[1])
        breakdown = ", ".join(f"{n}={c}" for n, c in ranked)
        logger.info(f"{discovery_name} tool-call breakdown ({sum(TOOL_CALL_COUNTS.values())} total): {breakdown}")
        _log_event(log_dir, "tool_call_counts", counts=dict(TOOL_CALL_COUNTS))

    logger.info(f"{discovery_name} complete: {len(results)} items in {turn + 1} turn(s)")
    return results


# ---------------------------------------------------------------------------
# Text-based tool calling (OpenAI / GPT)
# ---------------------------------------------------------------------------

def _loop_text_based(
    llm_client, messages, max_turns,
    project_root, snapshot_path,
    parse_answer_fn, parse_bare_json_fn,
    discovery_name,
) -> list:
    """Original text-based TOOL_CALL: approach for GPT models."""
    results = []
    conversation_trace = []

    generate_kwargs = {}

    for turn in range(max_turns):
        logger.info(f"=== {discovery_name} Turn {turn + 1}/{max_turns} (text-based) ===")
        try:
            response = llm_client.generate(messages=messages, **generate_kwargs)
            if not isinstance(response, str):
                response = str(response)
        except Exception as e:
            logger.warning(f"{discovery_name} agent call failed on turn {turn + 1}/{max_turns}: {e}")
            if results:
                logger.info(f"Returning {len(results)} items discovered before failure")
            break

        logger.info(
            f"LLM Response (turn {turn + 1}):\n{response[:500]}..."
            if len(response) > 500
            else f"LLM Response (turn {turn + 1}):\n{response}"
        )
        conversation_trace.append({"turn": turn + 1, "response": response})

        # On early turns (< MIN_TOOL_TURNS), reject immediate answers and
        # force the model to use tools first. This prevents models like Claude
        # from hallucinating answers without investigating the codebase.
        MIN_TOOL_TURNS = 3
        has_used_tools = any(
            t.get("tool_result") for t in conversation_trace
        )

        if turn < MIN_TOOL_TURNS and not has_used_tools:
            # Check if model tried to answer without investigating
            tool_result = _execute_text_tool_call(response, project_root, snapshot_path)
            if tool_result:
                logger.info(f"Tool executed, result length: {len(tool_result)} chars")
                messages.append({"role": "assistant", "content": response})
                messages.append({"role": "user", "content": f"Tool result:\n{tool_result}"})
                conversation_trace.append({"turn": turn + 1, "tool_result": tool_result[:1000]})
            else:
                # Model answered or rambled without calling tools — force it
                logger.info(f"Turn {turn + 1}: no tool call yet — rejecting response, forcing investigation")
                messages.append({"role": "assistant", "content": response})
                messages.append({"role": "user", "content": (
                    "STOP. Your answer is rejected. You have NOT investigated this codebase yet. "
                    "You MUST call tools to read the actual code before providing any answer. "
                    "Do NOT answer from memory or training data.\n\n"
                    "Call exactly ONE tool now using this format:\n"
                    "TOOL_CALL: read_directory(path=\"\")\n\n"
                    "Do not write anything else. Just the TOOL_CALL line."
                )})
                conversation_trace.append({"turn": turn + 1, "forced_tool_use": True})
            continue

        # If response contains a Python code block, extract it, save it, and run it
        # This MUST happen before FINAL_ANSWER stripping which could remove the code block
        import re as _re
        if "```python" in response:
            code_match = _re.search(r"```python\n(.*?)```", response, _re.DOTALL)
            if code_match:
                script_code = code_match.group(1).strip()
                if len(script_code) > 50:
                    from .enrichment_tools import write_script as _write_script
                    save_result = _write_script(project_root, script_code, "parser.py")
                    logger.info(f"Extracted code block → {save_result}")
                    import tempfile
                    script_path = Path(tempfile.gettempdir()) / "discovery" / "parser.py"
                    response = f'TOOL_CALL: run_framework_command(command="python {script_path}")'

        # If response contains BOTH a tool call AND FINAL_ANSWER, process the
        # tool call and ignore the FINAL_ANSWER — the model hasn't finished investigating.
        if "TOOL_CALL:" in response and "FINAL_ANSWER" in response:
            logger.info(f"Response has both TOOL_CALL and FINAL_ANSWER — processing tool call only")
            response = response[:response.index("FINAL_ANSWER")]

        # Check for FINAL_ANSWER — accumulate partial results
        if "FINAL_ANSWER" in response:
            # Parse all FINAL_ANSWER blocks
            parts = response.split("FINAL_ANSWER")
            all_empty = True
            batch = []
            for part in parts[1:]:
                part = part.strip()
                if not part or part == "[]":
                    continue
                parsed = parse_answer_fn("FINAL_ANSWER " + part)
                if parsed:
                    batch.extend(parsed)
                    all_empty = False

            # If ALL blocks were empty → model says done
            if all_empty and not batch:
                logger.info(f"Empty FINAL_ANSWER on turn {turn + 1} — model says done")
                break

            # Deduplicate and accumulate
            new_count = len(batch)
            existing_keys = {_item_key(r) for r in results}
            for item in batch:
                if _item_key(item) not in existing_keys:
                    results.append(item)
                    existing_keys.add(_item_key(item))
            logger.info(f"FINAL_ANSWER on turn {turn + 1}: {new_count} items ({len(results)} total)")

            # If we've used most of our turns, stop. Otherwise verify.
            if turn >= max_turns - 3:
                break

            # Verify parser output against grep
            verify_msg = _verify_parser_output(
                project_root, results, parse_bare_json_fn
            )

            messages.append({"role": "assistant", "content": response})

            if verify_msg:
                logger.info(f"FINAL_ANSWER verification: mismatch — forcing parser rewrite")
                messages.append({"role": "user", "content": verify_msg})
            else:
                # Counts are reasonable — accept result
                logger.info(f"FINAL_ANSWER verification: OK — accepting {len(results)} endpoints")
                break
            conversation_trace.append({"turn": turn + 1, "partial_results": new_count, "total": len(results)})
            continue

        # Bare JSON array (GPT-5.4+)
        stripped = response.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            batch = parse_bare_json_fn(stripped)
            if batch:
                existing_keys = {_item_key(r) for r in results}
                for item in batch:
                    if _item_key(item) not in existing_keys:
                        results.append(item)
                        existing_keys.add(_item_key(item))
                logger.info(f"Bare JSON on turn {turn + 1}: {len(batch)} items ({len(results)} total)")
                if turn >= max_turns - 3:
                    break
                messages.append({"role": "assistant", "content": response})
                messages.append({"role": "user", "content": (
                    f"Good — {len(results)} items found so far. "
                    "Are there MORE? If yes, investigate and provide another JSON array. "
                    "If done, respond with: FINAL_ANSWER []"
                )})
                continue

        # Execute text-based tool call
        tool_result = _execute_text_tool_call(response, project_root, snapshot_path)
        if tool_result:
            logger.info(f"Tool executed, result length: {len(tool_result)} chars")

            # If tool result is a JSON array of endpoints (from a parser script),
            # parse it directly instead of asking the LLM to reformat.
            # Handle both raw JSON and FINAL_ANSWER-prefixed JSON.
            stripped_result = tool_result.strip()
            if "FINAL_ANSWER" in stripped_result:
                idx = stripped_result.index("[") if "[" in stripped_result else -1
                if idx >= 0:
                    stripped_result = stripped_result[idx:]
            if stripped_result.startswith("[") and stripped_result.endswith("]") and len(stripped_result) > 100:
                try:
                    direct_batch = parse_bare_json_fn(stripped_result)
                    if direct_batch:
                        existing_keys = {_item_key(r) for r in results}
                        for item in direct_batch:
                            if _item_key(item) not in existing_keys:
                                results.append(item)
                                existing_keys.add(_item_key(item))
                        logger.info(f"Direct parse from tool result: {len(direct_batch)} items ({len(results)} total)")
                        conversation_trace.append({"turn": turn + 1, "direct_parse": len(direct_batch), "total": len(results)})

                        # Verify parser output against grep — if mismatch, force rewrite
                        verify_msg = _verify_parser_output(
                            project_root, results, parse_bare_json_fn
                        )
                        messages.append({"role": "assistant", "content": response})
                        if verify_msg:
                            logger.info(f"Parser verification: mismatch — forcing rewrite")
                            messages.append({"role": "user", "content": verify_msg})
                        else:
                            # Parser output matches grep — accept and stop
                            logger.info(f"Parser verification: OK — accepting {len(results)} endpoints")
                            break
                        continue
                except Exception:
                    pass

            messages.append({"role": "assistant", "content": response})

            # If parser script failed, tell the model to fix it
            if ("command failed" in tool_result or "Error" in tool_result or "Traceback" in tool_result) \
                    and ("parser" in response.lower() or "find_endpoints" in response.lower() or "/tmp/discovery/" in response):
                logger.info("Parser script failed — telling model to fix it")
                messages.append({"role": "user", "content": (
                    f"Tool result:\n{tool_result}\n\n"
                    "Your parser script has a bug. Fix the script with write_script and run it again."
                )})
                conversation_trace.append({"turn": turn + 1, "tool_result": tool_result[:1000], "parser_fix_requested": True})
                continue

            # Every REPORT_EVERY turns, force a partial report
            REPORT_EVERY = 10
            if turn > 0 and turn % REPORT_EVERY == 0:
                logger.info(f"Turn {turn + 1}: forcing partial report (every {REPORT_EVERY} turns)")
                messages.append({"role": "user", "content": (
                    f"Tool result:\n{tool_result}\n\n"
                    f"CHECKPOINT (turn {turn + 1}): Report what you've discovered SO FAR. "
                    "Output a FINAL_ANSWER JSON array with all endpoints/interactions found up to this point. "
                    "You will continue investigating after this report."
                )})
            else:
                messages.append({"role": "user", "content": f"Tool result:\n{tool_result}"})

            conversation_trace.append({"turn": turn + 1, "tool_result": tool_result[:1000]})
        else:
            logger.info("No tool call detected, prompting for FINAL_ANSWER")
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": "Please provide your FINAL_ANSWER now as a JSON array."})
            conversation_trace.append({"turn": turn + 1, "prompted_for_answer": True})

    _save_trace(conversation_trace, llm_client, discovery_name)

    if turn == max_turns - 1 and not results:
        logger.warning(f"{discovery_name} reached max turns ({max_turns}) without results")

    logger.info(f"{discovery_name} complete: {len(results)} items found in {turn + 1} turn(s)")
    return results


# ---------------------------------------------------------------------------
# Native tool calling (Claude / OpenAI-compatible proxy)
# ---------------------------------------------------------------------------

def _loop_native_tools(
    llm_client, messages, max_turns,
    project_root, snapshot_path,
    parse_answer_fn, parse_bare_json_fn,
    discovery_name,
) -> list:
    """Native function calling for Claude and compatible providers."""
    results = []
    conversation_trace = []
    tool_schemas = get_openai_tool_schemas()

    for turn in range(max_turns):
        logger.info(f"=== {discovery_name} Turn {turn + 1}/{max_turns} (native tools) ===")
        try:
            response = llm_client.generate_with_tools(
                messages=messages,
                tools=tool_schemas,
                max_tokens=4096,
            )
        except Exception as e:
            logger.warning(f"{discovery_name} agent call failed on turn {turn + 1}/{max_turns}: {e}")
            if results:
                logger.info(f"Returning {len(results)} items discovered before failure")
            break

        content = response["content"]
        tool_calls = response["tool_calls"]

        logger.info(
            f"LLM Response (turn {turn + 1}): content={len(content)} chars, "
            f"tool_calls={len(tool_calls)}"
        )
        if content:
            logger.info(
                f"Content: {content[:500]}..."
                if len(content) > 500
                else f"Content: {content}"
            )

        conversation_trace.append({
            "turn": turn + 1,
            "content": content,
            "tool_calls": [{"name": tc["name"], "arguments": tc["arguments"]} for tc in tool_calls],
        })

        # If there are tool calls, execute them and continue
        if tool_calls:
            # Append assistant message with tool calls
            assistant_msg = {"role": "assistant", "content": content or ""}
            # Store tool_calls on the message for LangChain compatibility
            assistant_msg["tool_calls"] = [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": json.dumps(tc["arguments"]) if isinstance(tc["arguments"], dict) else tc["arguments"],
                    },
                }
                for tc in tool_calls
            ]
            messages.append(assistant_msg)

            # Execute each tool and append results
            for tc in tool_calls:
                tool_result = _execute_native_tool_call(
                    tc["name"], tc["arguments"], project_root, snapshot_path
                )
                logger.info(f"  Tool {tc['name']}: {len(tool_result)} chars result")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                })
                conversation_trace.append({
                    "turn": turn + 1,
                    "tool_name": tc["name"],
                    "tool_result": tool_result[:1000],
                })
            continue

        # No tool calls — check for final answer in content
        if not content:
            logger.info("Empty response with no tool calls, prompting for answer")
            messages.append({"role": "assistant", "content": ""})
            messages.append({"role": "user", "content": "Please provide your FINAL_ANSWER now as a JSON array."})
            continue

        # Check for FINAL_ANSWER in text
        if "FINAL_ANSWER" in content:
            logger.info(f"FINAL_ANSWER detected on turn {turn + 1}")
            results = parse_answer_fn(content)
            break

        # Bare JSON array
        stripped = content.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            logger.info(f"Bare JSON array detected on turn {turn + 1}")
            results = parse_bare_json_fn(stripped)
            if results:
                break

        # Text response but no tool calls and no answer — ask to conclude
        logger.info("Text response without tool calls, prompting for FINAL_ANSWER")
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": "Please provide your FINAL_ANSWER now as a JSON array."})

    _save_trace(conversation_trace, llm_client, discovery_name)

    if turn == max_turns - 1 and not results:
        logger.warning(f"{discovery_name} reached max turns ({max_turns}) without results")

    logger.info(f"{discovery_name} complete: {len(results)} items found in {turn + 1} turn(s)")
    return results


# ---------------------------------------------------------------------------
# Tool execution helpers
# ---------------------------------------------------------------------------

def _item_key(item) -> str:
    """Generate a dedup key for an endpoint or interaction."""
    # EndpointInfo: deduplicate by path+operation or file+line
    if hasattr(item, "path") and hasattr(item, "operation"):
        return f"{item.operation}:{item.path}:{item.file}:{item.line}"
    # InteractionInfo: deduplicate by target+source
    if hasattr(item, "target") and hasattr(item, "source_class"):
        return f"{item.source_class}:{item.source_method}:{item.target}:{item.target_type}"
    return str(item)


def _verify_parser_output(
    project_root: str, results: list, parse_bare_json_fn: Callable
) -> Optional[str]:
    """Verify parser output against grep counts.

    Returns a message to send to the LLM if there's a significant mismatch,
    or None if the parser output looks reasonable.
    """
    from .enrichment_tools import grep as grep_tool

    # Grep for route DEFINITION patterns (not generic method calls).
    # These are framework-specific annotations/decorators/DSLs that define routes.
    verify_result = grep_tool(
        project_root,
        # Java Spring
        r"@GetMapping|@PostMapping|@PutMapping|@DeleteMapping|@PatchMapping|@RequestMapping|"
        # Python Flask/FastAPI/Django
        r"@app\.route|@router\.|@api_view|path\(|re_path\(|"
        # Ruby Rails
        r"resources :|resource :|get '|post '|put '|delete '|patch '|match '|"
        # Node/Express/NestJS
        r"@Get\(|@Post\(|@Put\(|@Delete\(|@Patch\(|"
        # Go Gin/Chi/Mux
        r"\.GET\(|\.POST\(|\.PUT\(|\.DELETE\(|\.PATCH\(|HandleFunc\(|"
        # C++ Oatpp
        r"ENDPOINT\(|OATPP_CREATE_COMPONENT",
        "**/*.{rb,py,ts,js,java,go,cs,cpp,hpp,kt,php}",
        limit=2000,
    )

    if not verify_result or "no matches" in verify_result:
        return None

    # Filter out test/spec/vendor lines
    lines = []
    for l in verify_result.splitlines():
        if not l.strip():
            continue
        if any(skip in l for skip in ["/test/", "/spec/", "/vendor/", "/node_modules/", "test_"]):
            continue
        lines.append(l)
    grep_count = len(lines)

    if grep_count == 0:
        return None

    ratio = grep_count / max(len(results), 1)
    logger.info(f"Verification: {len(results)} reported vs {grep_count} route-like grep hits (ratio: {ratio:.1f}x)")

    # Our grep has known blind spots:
    #   - Page-based PHP routing (each *.php file at root is implicitly an endpoint)
    #   - GraphQL operations (each mutation/query is a logical endpoint)
    #   - gRPC RPC definitions in .proto files
    #   - YAML route configs, XML configs, web.xml URL patterns
    # Therefore: trust Claude's count when reasonable, only flag EXTREME mismatches
    # and ask for VERIFICATION not CORRECTION.

    # Severe undercount (grep finds 3x+ more than parser, with > 20 absolute gap)
    if ratio > 3.0 and (grep_count - len(results)) > 20:
        sample_lines = "\n".join(lines[:15])
        return (
            f"Your count: {len(results)} endpoints. A simple grep for route patterns "
            f"finds {grep_count} matches. This is a large gap.\n\n"
            f"Sample grep matches (excluding tests):\n{sample_lines}\n\n"
            f"Please verify whether these matches represent real endpoints you missed. "
            f"If they're all already covered (e.g. class-level prefixes, comments, false positives), "
            f"keep your current answer. If you missed some real routes, update the file and report again."
        )

    # Severe overcount (parser found 5x+ more than grep, with > 50 absolute gap)
    # Note: this rarely fires correctly because grep misses many endpoint patterns.
    # Only flag truly extreme cases and ask Claude to verify their reasoning.
    inverse_ratio = len(results) / max(grep_count, 1)
    if inverse_ratio > 5.0 and (len(results) - grep_count) > 50:
        return (
            f"Your count: {len(results)} endpoints. A simple grep for route patterns "
            f"only finds {grep_count} matches. This is much more than expected.\n\n"
            f"Note: our grep may miss legitimate patterns (page-based PHP, GraphQL, gRPC, "
            f"YAML routes, etc.) — your higher count may be CORRECT.\n\n"
            f"Please verify: are all your endpoints real and addressable at runtime? "
            f"If yes, keep your answer. If you included duplicates or non-routes, update the file."
        )

    return None


def _execute_text_tool_call(response: str, project_root: str, snapshot_path: str) -> Optional[str]:
    """Parse and execute ALL text-based TOOL_CALL: lines from the LLM response."""
    if "TOOL_CALL:" not in response:
        return None

    results = []
    for line in response.splitlines():
        line = line.strip()
        if not line.startswith("TOOL_CALL:"):
            continue

        call_str = line[len("TOOL_CALL:"):].strip()
        paren_idx = call_str.find("(")
        if paren_idx == -1:
            continue

        tool_name = call_str[:paren_idx].strip()
        args_str = call_str[paren_idx + 1:].rstrip(")")

        if tool_name not in TOOLS:
            results.append(f"Unknown tool: {tool_name}. Available: {', '.join(TOOLS.keys())}")
            continue

        kwargs = _parse_text_tool_args(args_str)
        result = _run_tool(tool_name, kwargs, project_root, snapshot_path)
        results.append(f"[{tool_name}] {result}")

    return "\n\n".join(results) if results else None


def _execute_native_tool_call(
    tool_name: str, arguments: dict, project_root: str, snapshot_path: str
) -> str:
    """Execute a native tool call with structured arguments."""
    if tool_name not in TOOLS:
        return f"Unknown tool: {tool_name}. Available: {', '.join(TOOLS.keys())}"

    # Clean up arguments — remove None values, convert types
    kwargs = {}
    for k, v in arguments.items():
        if v is not None:
            if k in ("start_line", "end_line", "offset", "limit"):
                kwargs[k] = int(v)
            else:
                kwargs[k] = str(v)

    return _run_tool(tool_name, kwargs, project_root, snapshot_path)


# Per-discovery tool-call tracing. Counts reset at the start of each
# _loop_cli_delegated invocation; dumped to the run log at the end.
# Also mirrored to src.ast.observability for unified structured tracing.
TOOL_CALL_COUNTS: dict[str, int] = {}

# Tools that take project_root as their first arg (vs snapshot_path).
PROJECT_ROOT_TOOLS = (
    "read_source", "glob", "grep", "read_directory",
    "run_framework_command", "write_script",
    "list_directory_names", "read_manifest_contents",
)


def _run_tool(tool_name: str, kwargs: dict, project_root: str, snapshot_path: str) -> str:
    """Execute a tool function with the appropriate first argument."""
    import time as _time
    from src.ast.observability import trace_tool_call
    TOOL_CALL_COUNTS[tool_name] = TOOL_CALL_COUNTS.get(tool_name, 0) + 1
    _t0 = _time.time()
    try:
        tool_fn = TOOLS[tool_name]["function"]
        if tool_name in PROJECT_ROOT_TOOLS:
            result = tool_fn(project_root, **kwargs)
        elif snapshot_path:
            result = tool_fn(snapshot_path, **kwargs)
        else:
            result = "(no snapshot path available)"
        trace_tool_call("v1", tool_name, int((_time.time() - _t0) * 1000),
                         result_chars=len(result) if isinstance(result, str) else 0)
        return result
    except Exception as e:
        logger.warning(f"Tool execution failed for {tool_name}({kwargs}): {e}")
        trace_tool_call("v1", tool_name, int((_time.time() - _t0) * 1000),
                         error=type(e).__name__)
        return f"Tool error in {tool_name}: {e}"


def _parse_text_tool_args(args_str: str) -> dict:
    """Parse text-based tool call arguments.

    Handles:
      key="value"           — standard
      key=\"\"\"value\"\"\"  — triple-quoted (multiline scripts)
      key='value'           — single-quoted
      key=number            — integer values
    """
    import re
    kwargs = {}

    # Try triple-quoted first (greedy match between """ ... """)
    for match in re.finditer(r'(\w+)\s*=\s*"""(.*?)"""', args_str, re.DOTALL):
        key = match.group(1)
        kwargs[key] = match.group(2)

    # For script_content specifically: extract everything between the first
    # and last quote, handling escaped quotes and complex content.
    if "script_content" not in kwargs and "script_content=" in args_str:
        idx = args_str.index("script_content=")
        rest = args_str[idx + len("script_content="):]
        # Find the quote character
        quote_char = rest[0] if rest and rest[0] in ('"', "'") else None
        if quote_char:
            # Find matching close quote — handle escaped quotes
            content = []
            i = 1  # skip opening quote
            while i < len(rest):
                if rest[i] == '\\' and i + 1 < len(rest):
                    content.append(rest[i:i+2])
                    i += 2
                elif rest[i] == quote_char:
                    # Check if this is the end or part of a filename= parameter after
                    remaining = rest[i+1:].strip()
                    if not remaining or remaining.startswith(',') or remaining.startswith(')'):
                        break
                    # Check for next parameter: , filename=
                    if remaining.startswith(', ') and '=' in remaining.split(')')[0]:
                        break
                    content.append(rest[i])
                    i += 1
                else:
                    content.append(rest[i])
                    i += 1
            raw = ''.join(content)
            # Unescape: handle \n, \t but preserve \\ for regex
            if "\n" in raw:
                # Already has real newlines
                kwargs["script_content"] = raw
            else:
                try:
                    import json as _json
                    kwargs["script_content"] = _json.loads(f'"{raw}"')
                except Exception:
                    kwargs["script_content"] = raw.replace("\\n", "\n").replace("\\t", "\t")

    # Then single-quoted key="value" (skip keys already found)
    for match in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', args_str):
        key, value = match.group(1), match.group(2)
        if key not in kwargs:
            if key in ("start_line", "end_line", "offset", "limit"):
                kwargs[key] = int(value)
            else:
                kwargs[key] = value

    # Single-quoted values
    for match in re.finditer(r"(\w+)\s*=\s*'([^']*)'", args_str):
        key, value = match.group(1), match.group(2)
        if key not in kwargs:
            kwargs[key] = value

    # Integer values: key=123
    for match in re.finditer(r'(\w+)\s*=\s*(\d+)', args_str):
        key, value = match.group(1), int(match.group(2))
        if key not in kwargs:
            kwargs[key] = value

    return kwargs


def _save_trace(trace: list, llm_client, discovery_name: str):
    """Save conversation trace to temp file for debugging."""
    import tempfile
    model = getattr(llm_client, "model", "unknown")
    trace_file = Path(tempfile.gettempdir()) / f"{discovery_name}_trace_{model}.json"
    trace_file.write_text(json.dumps(trace, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info(f"Conversation trace saved to: {trace_file}")
