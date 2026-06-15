# Implementation Spec: Refactoring Impact Analysis for Standards Extractor

**Version:** 1.0  
**Created:** 2026-04-24  
**Status:** Draft  
**Target:** Standards Extractor Python Application  
**Depends On:** Spec 1 (Deep Dependency Analysis)

---

## Executive Summary

Build on the Deep Dependency Analysis foundation to add specialized refactoring tools: pre-commit change detection, multi-file coordinated rename, and refactoring safety guardrails. These tools prevent breaking changes and make large-scale refactors safe and traceable.

**Key Features:**
- **Pre-commit detection:** Git diff → affected symbols → blast radius
- **Multi-file rename:** Graph-based + text search with dry-run preview
- **Change tracking:** Monitor stale indexes and prompt re-analysis
- **Refactoring workflows:** Step-by-step safety checks

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Git Integration](#git-integration)
3. [Change Detection Engine](#change-detection-engine)
4. [Rename Orchestrator](#rename-orchestrator)
5. [Staleness Tracker](#staleness-tracker)
6. [Haikai Skills](#haikai-skills)
7. [REST API Endpoints](#rest-api-endpoints)
8. [Implementation Tasks](#implementation-tasks)
9. [Testing Strategy](#testing-strategy)
10. [Safety Guardrails](#safety-guardrails)

---

## 1. Architecture Overview

### High-Level Flow

```
┌──────────────────────────────────────────────────────┐
│              Git Repository State                     │
│                                                       │
│  • HEAD commit (current)                             │
│  • Staged changes (git diff --staged)                │
│  • Unstaged changes (git diff)                       │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│          Change Detection Engine                      │
│                                                       │
│  1. Parse git diff (hunks → line ranges)             │
│  2. Map line ranges → symbols                        │
│  3. Lookup symbols in dependency graph               │
│  4. Run impact analysis (upstream)                   │
│  5. Assess risk level                                │
│  6. Generate warnings                                │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│          Refactoring Tools                            │
│                                                       │
│  ┌────────────────┐  ┌──────────────────┐           │
│  │ RenameEngine   │  │ StalenesTracker  │           │
│  │                │  │                  │           │
│  │ • Graph scan   │  │ • Git commit     │           │
│  │ • Text search  │  │ • Index compare  │           │
│  │ • Dry-run      │  │ • Warn if stale  │           │
│  │ • Apply edits  │  │                  │           │
│  └────────────────┘  └──────────────────┘           │
└───────────────────────────────────────────────────────┘
```

### Integration with Existing Components

```
Dependency Graph (Spec 1)
    ↓
GraphStore (SQLite)
    ↓
Impact Analyzer ←─────┐
    ↓                 │
Change Detector ──────┘
    ↓
Rename Engine
    ↓
File Editor
```

---

## 2. Git Integration

### GitRepository Wrapper

**Location:** `src/refactoring/git_repository.py`

```python
"""
Git Repository Wrapper

Provides clean interface to git operations needed for refactoring analysis.
"""

import subprocess
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class DiffScope(str, Enum):
    """Scope of changes to analyze."""
    STAGED = "staged"          # git diff --staged
    UNSTAGED = "unstaged"      # git diff
    ALL = "all"                # Both staged and unstaged
    COMMIT = "commit"          # Specific commit vs parent


@dataclass
class DiffHunk:
    """A single diff hunk (changed region)."""
    file_path: str
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: List[str]
    
    @property
    def affected_lines(self) -> List[int]:
        """Get list of affected line numbers in new file."""
        return list(range(self.new_start, self.new_start + self.new_count))


@dataclass
class FileDiff:
    """Diff for a single file."""
    file_path: str
    status: str  # 'modified', 'added', 'deleted', 'renamed'
    hunks: List[DiffHunk]
    old_path: Optional[str] = None  # For renames


class GitRepository:
    """
    Git repository operations for refactoring analysis.
    """
    
    def __init__(self, repo_path: Path):
        self.repo_path = repo_path
        self._validate_repo()
    
    def _validate_repo(self):
        """Ensure this is a valid git repository."""
        git_dir = self.repo_path / ".git"
        if not git_dir.exists():
            raise ValueError(f"Not a git repository: {self.repo_path}")
    
    def get_current_commit(self) -> str:
        """Get current HEAD commit hash."""
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    
    def get_diff(
        self,
        scope: DiffScope = DiffScope.STAGED,
        commit: Optional[str] = None
    ) -> List[FileDiff]:
        """
        Get git diff as structured data.
        
        Args:
            scope: Which changes to include
            commit: Specific commit hash (for COMMIT scope)
            
        Returns:
            List of FileDiff objects
        """
        # Build git diff command
        cmd = ["git", "diff", "--unified=0"]  # No context lines
        
        if scope == DiffScope.STAGED:
            cmd.append("--staged")
        elif scope == DiffScope.UNSTAGED:
            pass  # Default
        elif scope == DiffScope.ALL:
            cmd.append("HEAD")
        elif scope == DiffScope.COMMIT:
            if not commit:
                raise ValueError("commit required for COMMIT scope")
            cmd.append(f"{commit}^")
            cmd.append(commit)
        
        result = subprocess.run(
            cmd,
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=True
        )
        
        return self._parse_diff(result.stdout)
    
    def _parse_diff(self, diff_text: str) -> List[FileDiff]:
        """
        Parse git diff output into structured format.
        
        Diff format:
        diff --git a/file.py b/file.py
        index abc123..def456 100644
        --- a/file.py
        +++ b/file.py
        @@ -10,3 +10,4 @@ def foo():
        -    old line
        +    new line
        +    added line
        """
        diffs = []
        current_file = None
        current_hunk = None
        
        lines = diff_text.split('\n')
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            # New file
            if line.startswith('diff --git'):
                if current_file:
                    if current_hunk:
                        current_file.hunks.append(current_hunk)
                    diffs.append(current_file)
                
                # Parse: diff --git a/path b/path
                parts = line.split()
                file_path = parts[2][2:]  # Remove 'a/' prefix
                
                current_file = FileDiff(
                    file_path=file_path,
                    status='modified',
                    hunks=[]
                )
                current_hunk = None
            
            # Hunk header
            elif line.startswith('@@'):
                if current_hunk:
                    current_file.hunks.append(current_hunk)
                
                # Parse: @@ -10,3 +10,4 @@ context
                match = re.match(r'@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@', line)
                if match:
                    old_start = int(match.group(1))
                    old_count = int(match.group(2)) if match.group(2) else 1
                    new_start = int(match.group(3))
                    new_count = int(match.group(4)) if match.group(4) else 1
                    
                    current_hunk = DiffHunk(
                        file_path=current_file.file_path,
                        old_start=old_start,
                        old_count=old_count,
                        new_start=new_start,
                        new_count=new_count,
                        lines=[]
                    )
            
            # Hunk content
            elif current_hunk and (line.startswith('+') or line.startswith('-') or line.startswith(' ')):
                current_hunk.lines.append(line)
            
            i += 1
        
        # Add last file
        if current_file:
            if current_hunk:
                current_file.hunks.append(current_hunk)
            diffs.append(current_file)
        
        return diffs
    
    def get_file_at_commit(self, file_path: str, commit: str = "HEAD") -> str:
        """Get file contents at specific commit."""
        result = subprocess.run(
            ["git", "show", f"{commit}:{file_path}"],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout
    
    def get_changed_files(self, scope: DiffScope = DiffScope.ALL) -> List[str]:
        """Get list of changed file paths."""
        diffs = self.get_diff(scope)
        return [d.file_path for d in diffs]
    
    def has_uncommitted_changes(self) -> bool:
        """Check if there are any uncommitted changes."""
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=True
        )
        return bool(result.stdout.strip())
```

---

## 3. Change Detection Engine

### ChangeDetector

**Location:** `src/refactoring/change_detector.py`

```python
"""
Change Detection Engine

Maps git changes to dependency graph symbols and analyzes blast radius.
"""

from typing import List, Dict, Set, Optional
from dataclasses import dataclass
from enum import Enum

from src.refactoring.git_repository import GitRepository, DiffScope, FileDiff, DiffHunk
from src.dependency.graph_store import GraphStore
from src.dependency.impact_analyzer import ImpactAnalyzer, RiskLevel


class ChangeType(str, Enum):
    """Type of change detected."""
    SYMBOL_MODIFIED = "symbol_modified"
    SYMBOL_ADDED = "symbol_added"
    SYMBOL_DELETED = "symbol_deleted"
    FILE_MODIFIED = "file_modified"


@dataclass
class AffectedSymbol:
    """A symbol affected by git changes."""
    uid: str
    name: str
    kind: str
    file_path: str
    line: int
    change_type: ChangeType
    confidence: float  # How confident we are this symbol was affected


@dataclass
class ChangeAnalysisResult:
    """Result of change detection analysis."""
    # Summary
    changed_files: List[str]
    changed_symbols: List[AffectedSymbol]
    affected_processes: List[Dict]
    risk_level: RiskLevel
    
    # Detailed breakdown
    symbols_modified: int
    symbols_added: int
    symbols_deleted: int
    immediate_dependents: int
    transitive_dependents: int
    
    # Warnings
    warnings: List[str]
    should_proceed: bool


class ChangeDetector:
    """
    Detects code changes from git and analyzes their impact.
    """
    
    def __init__(self, company: str, project: str, repo_path: str):
        self.company = company
        self.project = project
        self.repo = GitRepository(Path(repo_path))
        self.store = GraphStore(company, project)
        self.analyzer = ImpactAnalyzer(company, project)
    
    def detect_changes(
        self,
        scope: DiffScope = DiffScope.ALL,
        min_confidence: float = 0.7
    ) -> ChangeAnalysisResult:
        """
        Detect and analyze changes.
        
        Workflow:
        1. Get git diff
        2. Map changed lines → symbols
        3. Run impact analysis on each symbol
        4. Aggregate results
        5. Assess risk
        
        Args:
            scope: Which changes to analyze
            min_confidence: Minimum confidence for impact analysis
            
        Returns:
            ChangeAnalysisResult with full analysis
        """
        print(f"Detecting changes (scope: {scope.value})...")
        
        # Get git diff
        diffs = self.repo.get_diff(scope)
        
        if not diffs:
            return ChangeAnalysisResult(
                changed_files=[],
                changed_symbols=[],
                affected_processes=[],
                risk_level=RiskLevel.LOW,
                symbols_modified=0,
                symbols_added=0,
                symbols_deleted=0,
                immediate_dependents=0,
                transitive_dependents=0,
                warnings=[],
                should_proceed=True
            )
        
        # Map changes to symbols
        changed_symbols = self._map_changes_to_symbols(diffs)
        
        print(f"  Found {len(changed_symbols)} changed symbols")
        
        # Analyze impact for each symbol
        all_dependents = set()
        affected_processes = []
        
        for symbol in changed_symbols:
            if symbol.change_type == ChangeType.SYMBOL_DELETED:
                # Deleted symbols can't have new dependencies
                # But we should check what depended on them
                dependents = self._find_dependents(symbol.uid, min_confidence)
                all_dependents.update(dependents)
            
            elif symbol.change_type in [ChangeType.SYMBOL_MODIFIED, ChangeType.SYMBOL_ADDED]:
                # Analyze upstream impact
                impact = self.analyzer.analyze(
                    target=symbol.uid,
                    direction="upstream",
                    max_depth=2,
                    min_confidence=min_confidence
                )
                
                # Collect dependents
                for depth, nodes in impact.depths.items():
                    if depth > 0:  # Skip target itself
                        all_dependents.update(n.uid for n in nodes)
                
                # Check process involvement
                processes = self.store.get_processes_containing(symbol.uid)
                for proc in processes:
                    if proc not in affected_processes:
                        affected_processes.append(proc)
        
        # Calculate risk
        immediate = len([s for s in changed_symbols if s.change_type == ChangeType.SYMBOL_MODIFIED])
        transitive = len(all_dependents)
        risk = self._assess_change_risk(immediate, transitive, affected_processes)
        
        # Generate warnings
        warnings = self._generate_warnings(
            changed_symbols,
            all_dependents,
            affected_processes,
            risk
        )
        
        return ChangeAnalysisResult(
            changed_files=[d.file_path for d in diffs],
            changed_symbols=changed_symbols,
            affected_processes=affected_processes,
            risk_level=risk,
            symbols_modified=len([s for s in changed_symbols if s.change_type == ChangeType.SYMBOL_MODIFIED]),
            symbols_added=len([s for s in changed_symbols if s.change_type == ChangeType.SYMBOL_ADDED]),
            symbols_deleted=len([s for s in changed_symbols if s.change_type == ChangeType.SYMBOL_DELETED]),
            immediate_dependents=immediate,
            transitive_dependents=transitive,
            warnings=warnings,
            should_proceed=(risk in [RiskLevel.LOW, RiskLevel.MEDIUM])
        )
    
    def _map_changes_to_symbols(self, diffs: List[FileDiff]) -> List[AffectedSymbol]:
        """
        Map git diff hunks to dependency graph symbols.
        
        For each hunk:
        1. Get affected line range
        2. Query graph for symbols in that file/range
        3. Determine change type (modified/added/deleted)
        """
        affected = []
        
        for file_diff in diffs:
            # Get all symbols in this file
            file_symbols = self.store.get_symbols_in_file(file_diff.file_path)
            
            for hunk in file_diff.hunks:
                affected_lines = hunk.affected_lines
                
                # Find symbols overlapping with changed lines
                for symbol in file_symbols:
                    if self._overlaps(
                        symbol['start_line'],
                        symbol['end_line'],
                        min(affected_lines),
                        max(affected_lines)
                    ):
                        # Determine change type
                        change_type = self._infer_change_type(hunk, symbol)
                        
                        affected.append(AffectedSymbol(
                            uid=symbol['uid'],
                            name=symbol['name'],
                            kind=symbol['kind'],
                            file_path=symbol['file_path'],
                            line=symbol['start_line'],
                            change_type=change_type,
                            confidence=0.9  # High confidence for exact match
                        ))
        
        return affected
    
    def _overlaps(
        self,
        sym_start: int,
        sym_end: int,
        change_start: int,
        change_end: int
    ) -> bool:
        """Check if symbol line range overlaps with changed line range."""
        return not (sym_end < change_start or sym_start > change_end)
    
    def _infer_change_type(self, hunk: DiffHunk, symbol: Dict) -> ChangeType:
        """
        Infer whether symbol was modified, added, or deleted.
        
        Heuristics:
        - If hunk has only '+' lines → likely added
        - If hunk has only '-' lines → likely deleted
        - If hunk has mix → modified
        """
        plus_lines = sum(1 for line in hunk.lines if line.startswith('+'))
        minus_lines = sum(1 for line in hunk.lines if line.startswith('-'))
        
        if plus_lines > 0 and minus_lines == 0:
            return ChangeType.SYMBOL_ADDED
        elif minus_lines > 0 and plus_lines == 0:
            return ChangeType.SYMBOL_DELETED
        else:
            return ChangeType.SYMBOL_MODIFIED
    
    def _find_dependents(self, symbol_uid: str, min_confidence: float) -> Set[str]:
        """Find all symbols that depend on the given symbol."""
        # This is a simplified version; in practice use ImpactAnalyzer
        symbol = self.store.find_node(symbol_uid)
        if not symbol:
            return set()
        
        dependents = self.store.get_incoming_edges(
            symbol['id'],
            relation_types=['CALLS', 'IMPORTS'],
            min_confidence=min_confidence
        )
        
        return {self.store.get_node_by_id(edge['source_id'])['uid'] for edge in dependents}
    
    def _assess_change_risk(
        self,
        immediate: int,
        transitive: int,
        processes: List[Dict]
    ) -> RiskLevel:
        """Assess overall risk of changes."""
        # Weighted scoring
        score = immediate * 1.0 + transitive * 0.5 + len(processes) * 2.0
        
        if score < 5:
            return RiskLevel.LOW
        elif score < 15:
            return RiskLevel.MEDIUM
        elif score < 40:
            return RiskLevel.HIGH
        else:
            return RiskLevel.CRITICAL
    
    def _generate_warnings(
        self,
        changed: List[AffectedSymbol],
        dependents: Set[str],
        processes: List[Dict],
        risk: RiskLevel
    ) -> List[str]:
        """Generate actionable warnings."""
        warnings = []
        
        if risk in [RiskLevel.HIGH, RiskLevel.CRITICAL]:
            warnings.append(
                f"⚠️  {risk.value} RISK: {len(changed)} symbols changed, {len(dependents)} dependents affected"
            )
        
        # Check for deleted symbols with dependents
        deleted = [s for s in changed if s.change_type == ChangeType.SYMBOL_DELETED]
        if deleted:
            warnings.append(
                f"⚠️  {len(deleted)} symbols deleted (may break dependents)"
            )
        
        # Check process impact
        if len(processes) > 0:
            warnings.append(
                f"⚠️  Affects {len(processes)} execution flows"
            )
        
        # Check for entry point changes
        entry_points = [
            s for s in changed
            if 'route' in s.name.lower() or 'handler' in s.name.lower() or 'main' in s.name.lower()
        ]
        if entry_points:
            warnings.append(
                f"⚠️  Changes to {len(entry_points)} entry points (routes/handlers/main)"
            )
        
        return warnings
```

---

## 4. Rename Orchestrator

### RenameEngine

**Location:** `src/refactoring/rename_engine.py`

```python
"""
Rename Engine

Multi-file coordinated rename with graph-based and text search.
"""

from typing import List, Dict, Optional, Set
from dataclasses import dataclass
from pathlib import Path
import re

from src.dependency.graph_store import GraphStore


class EditSource(str, Enum):
    """Source of a rename edit."""
    GRAPH = "graph"          # From dependency graph (high confidence)
    TEXT_SEARCH = "text"     # From grep (review needed)


@dataclass
class RenameEdit:
    """A single edit for rename operation."""
    file_path: str
    line_number: int
    old_text: str
    new_text: str
    source: EditSource
    confidence: float
    reason: str


@dataclass
class RenameResult:
    """Result of rename operation."""
    status: str  # 'success', 'dry_run', 'error'
    files_affected: int
    total_edits: int
    graph_edits: int
    text_search_edits: int
    edits: List[RenameEdit]
    warnings: List[str]


class RenameEngine:
    """
    Multi-file coordinated rename engine.
    """
    
    def __init__(self, company: str, project: str, project_root: Path):
        self.company = company
        self.project = project
        self.project_root = project_root
        self.store = GraphStore(company, project)
    
    def rename(
        self,
        symbol_name: str,
        new_name: str,
        dry_run: bool = True,
        scope: str = "both"  # 'graph', 'text', 'both'
    ) -> RenameResult:
        """
        Rename a symbol across multiple files.
        
        Two-phase approach:
        1. Graph-based: Follow edges to find all references
        2. Text-based: Grep for remaining occurrences
        
        Args:
            symbol_name: Current symbol name
            new_name: New symbol name
            dry_run: If True, preview only (don't apply)
            scope: 'graph' (high conf only), 'text' (grep all), 'both'
            
        Returns:
            RenameResult with all proposed/applied edits
        """
        print(f"{'[DRY RUN] ' if dry_run else ''}Renaming {symbol_name} → {new_name}...")
        
        edits = []
        warnings = []
        
        # Phase 1: Graph-based rename
        if scope in ['graph', 'both']:
            graph_edits = self._graph_based_rename(symbol_name, new_name)
            edits.extend(graph_edits)
            print(f"  Found {len(graph_edits)} graph-based edits")
        
        # Phase 2: Text-based rename
        if scope in ['text', 'both']:
            text_edits = self._text_based_rename(symbol_name, new_name, edits)
            edits.extend(text_edits)
            print(f"  Found {len(text_edits)} text-search edits")
            
            if text_edits:
                warnings.append(
                    f"⚠️  {len(text_edits)} edits from text search - REVIEW CAREFULLY"
                )
        
        # Sort edits by file and line
        edits.sort(key=lambda e: (e.file_path, e.line_number))
        
        # Apply edits (if not dry run)
        if not dry_run:
            self._apply_edits(edits)
            status = "success"
        else:
            status = "dry_run"
        
        return RenameResult(
            status=status,
            files_affected=len(set(e.file_path for e in edits)),
            total_edits=len(edits),
            graph_edits=len([e for e in edits if e.source == EditSource.GRAPH]),
            text_search_edits=len([e for e in edits if e.source == EditSource.TEXT_SEARCH]),
            edits=edits,
            warnings=warnings
        )
    
    def _graph_based_rename(self, old_name: str, new_name: str) -> List[RenameEdit]:
        """
        Find all references using dependency graph.
        
        Steps:
        1. Find target symbol
        2. Find definition site
        3. Find all incoming edges (CALLS, IMPORTS)
        4. Extract file:line for each reference
        5. Generate edit for each
        """
        edits = []
        
        # Find target symbol
        target = self.store.find_node(old_name)
        if not target:
            print(f"  Warning: Symbol not found in graph: {old_name}")
            return edits
        
        # Edit 1: Definition site
        edits.append(RenameEdit(
            file_path=target['file_path'],
            line_number=target['start_line'],
            old_text=f"{old_name}",  # Simplified; real impl would get exact text
            new_text=f"{new_name}",
            source=EditSource.GRAPH,
            confidence=1.0,
            reason="Definition site"
        ))
        
        # Edit 2+: All call sites
        incoming = self.store.get_incoming_edges(
            target['id'],
            relation_types=['CALLS', 'IMPORTS']
        )
        
        for edge in incoming:
            source_node = self.store.get_node_by_id(edge['source_id'])
            
            # Get metadata for exact location
            metadata = edge.get('metadata', {})
            caller_location = metadata.get('caller_location', '')
            
            if ':' in caller_location:
                file_path, line_num = caller_location.rsplit(':', 1)
                
                edits.append(RenameEdit(
                    file_path=file_path,
                    line_number=int(line_num),
                    old_text=f"{old_name}",
                    new_text=f"{new_name}",
                    source=EditSource.GRAPH,
                    confidence=edge['confidence'],
                    reason=f"{edge['relation_type']} edge from {source_node['name']}"
                ))
        
        return edits
    
    def _text_based_rename(
        self,
        old_name: str,
        new_name: str,
        existing_edits: List[RenameEdit]
    ) -> List[RenameEdit]:
        """
        Find remaining occurrences using text search (grep).
        
        Excludes:
        - Locations already covered by graph-based edits
        - Test files (optionally)
        - Comments (optionally)
        """
        import subprocess
        
        edits = []
        
        # Track already-edited locations
        edited_locations = set()
        for edit in existing_edits:
            edited_locations.add((edit.file_path, edit.line_number))
        
        # Grep for symbol name
        try:
            result = subprocess.run(
                [
                    "grep",
                    "-rn",  # Recursive, show line numbers
                    "--include=*.py",
                    "--include=*.ts",
                    "--include=*.js",
                    "--include=*.go",
                    "--include=*.java",
                    "--include=*.cs",
                    "--include=*.rs",
                    "--include=*.c",
                    "--include=*.cpp",
                    rf"\b{re.escape(old_name)}\b",  # Word boundaries
                    str(self.project_root)
                ],
                capture_output=True,
                text=True,
                check=False  # Don't raise on non-zero (no matches)
            )
            
            # Parse grep output
            # Format: path/to/file.py:123:    code line with symbol
            for line in result.stdout.split('\n'):
                if not line:
                    continue
                
                parts = line.split(':', 2)
                if len(parts) < 3:
                    continue
                
                file_path = parts[0]
                line_num = int(parts[1])
                code_line = parts[2]
                
                # Skip if already edited
                if (file_path, line_num) in edited_locations:
                    continue
                
                # Skip test files (optional)
                if '/test' in file_path.lower():
                    continue
                
                edits.append(RenameEdit(
                    file_path=file_path,
                    line_number=line_num,
                    old_text=old_name,
                    new_text=new_name,
                    source=EditSource.TEXT_SEARCH,
                    confidence=0.5,  # Lower confidence
                    reason="Found by text search (REVIEW THIS)"
                ))
        
        except subprocess.CalledProcessError as e:
            print(f"  Warning: grep failed: {e}")
        
        return edits
    
    def _apply_edits(self, edits: List[RenameEdit]):
        """
        Apply rename edits to files.
        
        Groups edits by file and applies in reverse line order
        to avoid line number shifts.
        """
        from collections import defaultdict
        
        # Group by file
        by_file = defaultdict(list)
        for edit in edits:
            by_file[edit.file_path].append(edit)
        
        # Apply to each file
        for file_path, file_edits in by_file.items():
            # Sort by line number (reverse) to avoid line shifts
            file_edits.sort(key=lambda e: e.line_number, reverse=True)
            
            # Read file
            full_path = self.project_root / file_path
            with open(full_path, 'r') as f:
                lines = f.readlines()
            
            # Apply edits
            for edit in file_edits:
                line_idx = edit.line_number - 1  # 0-indexed
                if 0 <= line_idx < len(lines):
                    lines[line_idx] = lines[line_idx].replace(
                        edit.old_text,
                        edit.new_text
                    )
            
            # Write file
            with open(full_path, 'w') as f:
                f.writelines(lines)
            
            print(f"  ✓ Applied {len(file_edits)} edits to {file_path}")
```

---

## 5. Staleness Tracker

### StalenessTracker

**Location:** `src/refactoring/staleness_tracker.py`

```python
"""
Staleness Tracker

Monitors when dependency graph is out of sync with git repository.
"""

from typing import Dict, Optional
from dataclasses import dataclass
from pathlib import Path

from src.refactoring.git_repository import GitRepository
from src.dependency.graph_store import GraphStore


@dataclass
class StalenessStatus:
    """Staleness status for a project."""
    is_stale: bool
    indexed_commit: str
    current_commit: str
    commits_behind: int
    recommendation: str


class StalenessTracker:
    """
    Tracks whether dependency graph is up-to-date with git.
    """
    
    def __init__(self, company: str, project: str, repo_path: Path):
        self.company = company
        self.project = project
        self.repo = GitRepository(repo_path)
        self.store = GraphStore(company, project)
    
    def check_staleness(self) -> StalenessStatus:
        """
        Check if graph is stale.
        
        Compares graph metadata 'source_commit' to current HEAD.
        """
        # Get indexed commit from graph metadata
        metadata = self.store.get_metadata()
        indexed_commit = metadata.get('source_commit', '')
        
        # Get current HEAD
        current_commit = self.repo.get_current_commit()
        
        # Compare
        is_stale = (indexed_commit != current_commit)
        
        # Count commits behind
        commits_behind = 0
        if is_stale and indexed_commit:
            commits_behind = self._count_commits_between(
                indexed_commit,
                current_commit
            )
        
        # Generate recommendation
        if is_stale:
            recommendation = (
                f"Graph is {commits_behind} commits behind. "
                f"Run: POST /api/v1/analyze-dependencies"
            )
        else:
            recommendation = "Graph is up-to-date"
        
        return StalenessStatus(
            is_stale=is_stale,
            indexed_commit=indexed_commit,
            current_commit=current_commit,
            commits_behind=commits_behind,
            recommendation=recommendation
        )
    
    def _count_commits_between(self, old: str, new: str) -> int:
        """Count number of commits between two refs."""
        import subprocess
        
        try:
            result = subprocess.run(
                ["git", "rev-list", "--count", f"{old}..{new}"],
                cwd=self.repo.repo_path,
                capture_output=True,
                text=True,
                check=True
            )
            return int(result.stdout.strip())
        except:
            return 0
    
    def update_commit_metadata(self):
        """Update graph metadata with current commit."""
        current = self.repo.get_current_commit()
        self.store.update_metadata({'source_commit': current})
```

---

## 6. Haikai Skills

### Skill: /detect-changes

**Location:** `haikai-profiles/default/commands/detect-changes/SKILL.md`

```markdown
---
name: detect-changes
description: Detect and analyze the impact of uncommitted changes before committing
tags: [refactoring, safety, git]
---

# Detect Changes

Pre-commit change detection that maps your git changes to dependency graph symbols and analyzes blast radius.

## When to Use

- Before committing code
- Before creating a pull request
- After making refactoring changes
- When unsure of change impact

## Usage

```
/detect-changes [options]
```

### Options

- `--scope <staged|unstaged|all>` - Which changes to analyze (default: all)
- `--confidence <0.0-1.0>` - Minimum confidence for impact analysis (default: 0.7)

### Examples

```bash
# Analyze all uncommitted changes
/detect-changes

# Analyze only staged changes (ready to commit)
/detect-changes --scope staged

# High-confidence analysis only
/detect-changes --confidence 0.9
```

## Output

```
CHANGE DETECTION RESULTS:

CHANGED FILES (4):
  • src/auth/validate.py
  • src/api/auth.py
  • src/services/user.py
  • tests/test_auth.py

CHANGED SYMBOLS (3):
  ✏️  validateUser (src/auth/validate.py:15) - MODIFIED
  ✏️  handleLogin (src/api/auth.py:45) - MODIFIED
  ➕ checkPasswordStrength (src/auth/validate.py:32) - ADDED

BLAST RADIUS:
  Immediate: 3 symbols modified
  Transitive: 8 symbols affected
  Processes: 2 flows affected

AFFECTED PROCESSES:
  • LoginFlow (7 steps, priority: 0.92)
    - Step 2: validateUser ← MODIFIED
  
  • RegistrationFlow (5 steps, priority: 0.78)
    - Step 3: validateUser ← MODIFIED

RISK ASSESSMENT: MEDIUM
  ⚠️  8 total symbols affected
  ⚠️  Affects 2 execution flows
  ℹ️  1 new symbol added (checkPasswordStrength)

RECOMMENDATION: ✓ Proceed with caution
  • Test LoginFlow and RegistrationFlow thoroughly
  • Run: pytest tests/test_auth.py
  • Update API documentation if validateUser signature changed
```

## API Integration

```python
POST /api/v1/refactoring/detect-changes

{
  "company": "acme",
  "project": "backend",
  "scope": "all",
  "min_confidence": 0.7
}
```
```

### Skill: /safe-rename

**Location:** `haikai-profiles/default/commands/safe-rename/SKILL.md`

```markdown
---
name: safe-rename
description: Safely rename symbols across multiple files with preview and graph awareness
tags: [refactoring, rename]
---

# Safe Rename

Multi-file coordinated rename using dependency graph and text search.

## When to Use

- Renaming a function, class, method, or variable
- When you want to ensure all references are updated
- Before refactoring with name changes

## Usage

```
/safe-rename <old-name> <new-name> [options]
```

### Options

- `--scope <graph|text|both>` - Rename scope (default: both)
- `--dry-run` - Preview changes without applying (default: true)
- `--apply` - Apply changes immediately (disables dry-run)

### Examples

```bash
# Preview rename (default is dry-run)
/safe-rename validateUser verifyUser

# Apply rename immediately
/safe-rename validateUser verifyUser --apply

# Graph-based only (high confidence)
/safe-rename UserService AccountService --scope graph

# Include text search (finds comments, docs)
/safe-rename login authenticate --scope both
```

## Output (Dry-Run)

```
[DRY RUN] Renaming validateUser → verifyUser...

FILES AFFECTED: 5
TOTAL EDITS: 8
  • Graph-based: 6 (high confidence)
  • Text search: 2 (review carefully)

PROPOSED CHANGES:

1. src/auth/validate.py:15 [GRAPH, confidence: 1.00]
   - def validateUser(credentials: dict) -> User | None:
   + def verifyUser(credentials: dict) -> User | None:
   Reason: Definition site

2. src/api/auth.py:45 [GRAPH, confidence: 0.90]
   - result = validateUser(credentials)
   + result = verifyUser(credentials)
   Reason: CALLS edge from handleLogin

3. src/api/auth.py:78 [GRAPH, confidence: 0.90]
   - user = validateUser(data)
   + user = verifyUser(data)
   Reason: CALLS edge from handleRegister

4. src/controllers/user.py:12 [GRAPH, confidence: 0.85]
   - from auth.validate import validateUser
   + from auth.validate import verifyUser
   Reason: IMPORTS edge

5. tests/auth.test.py:23 [GRAPH, confidence: 0.92]
   - mock_validateUser = Mock()
   + mock_verifyUser = Mock()
   Reason: CALLS edge from test_login

6. README.md:203 [TEXT, confidence: 0.50]
   - The validateUser function handles authentication
   + The verifyUser function handles authentication
   Reason: Found by text search (REVIEW THIS)

⚠️  WARNINGS:
  • 2 edits from text search - REVIEW CAREFULLY
  • Consider updating API documentation

NEXT STEPS:
  1. Review all proposed changes above
  2. Run: /safe-rename validateUser verifyUser --apply
  3. Test affected code
  4. Commit changes
```

## Output (Applied)

```
✓ Renaming validateUser → verifyUser... COMPLETE

FILES MODIFIED: 5
  ✓ src/auth/validate.py (1 edit)
  ✓ src/api/auth.py (2 edits)
  ✓ src/controllers/user.py (1 edit)
  ✓ tests/auth.test.py (1 edit)
  ✓ README.md (1 edit)

TOTAL EDITS: 8

NEXT STEPS:
  1. Run tests: pytest tests/test_auth.py
  2. Check for regressions
  3. Commit: git add -A && git commit -m "Rename validateUser to verifyUser"
```

## API Integration

```python
POST /api/v1/refactoring/rename

{
  "company": "acme",
  "project": "backend",
  "old_name": "validateUser",
  "new_name": "verifyUser",
  "dry_run": true,
  "scope": "both"
}
```
```

### Skill: /check-staleness

**Location:** `haikai-profiles/default/commands/check-staleness/SKILL.md`

```markdown
---
name: check-staleness
description: Check if dependency graph is up-to-date with current git commit
tags: [maintenance, git]
---

# Check Staleness

Checks whether the dependency graph needs to be rebuilt based on git history.

## When to Use

- Before running impact analysis
- After pulling new code
- Periodically to ensure graph accuracy

## Usage

```
/check-staleness
```

## Output

```
STALENESS CHECK FOR: acme/backend

Status: ⚠️  STALE

Indexed Commit: a1b2c3d4
Current Commit: e5f6g7h8
Commits Behind: 3

RECOMMENDATION:
  Graph is 3 commits behind. Analysis may be inaccurate.
  
  To update:
    POST /api/v1/analyze-dependencies
    OR
    Run: /rebuild-graph
```

## API Integration

```python
GET /api/v1/dependency-graph/{company}/{project}/staleness

Response:
{
  "is_stale": true,
  "indexed_commit": "a1b2c3d4",
  "current_commit": "e5f6g7h8",
  "commits_behind": 3,
  "recommendation": "Graph is 3 commits behind..."
}
```
```

---

## 7. REST API Endpoints

### Endpoint: Detect Changes

```python
@router.post("/api/v1/refactoring/detect-changes")
async def detect_changes(
    request: DetectChangesRequest,
    auth: str = Depends(verify_auth)
) -> DetectChangesResponse:
    """
    Detect and analyze uncommitted changes.
    """
    from src.refactoring.change_detector import ChangeDetector, DiffScope
    
    # Get project root
    project_root = get_project_root(request.company, request.project)
    
    detector = ChangeDetector(
        request.company,
        request.project,
        str(project_root)
    )
    
    result = detector.detect_changes(
        scope=DiffScope(request.scope),
        min_confidence=request.min_confidence
    )
    
    return DetectChangesResponse(
        changed_files=result.changed_files,
        changed_symbols=[
            {
                "uid": s.uid,
                "name": s.name,
                "kind": s.kind,
                "file_path": s.file_path,
                "line": s.line,
                "change_type": s.change_type.value,
                "confidence": s.confidence
            }
            for s in result.changed_symbols
        ],
        affected_processes=result.affected_processes,
        risk_level=result.risk_level.value,
        summary={
            "symbols_modified": result.symbols_modified,
            "symbols_added": result.symbols_added,
            "symbols_deleted": result.symbols_deleted,
            "immediate_dependents": result.immediate_dependents,
            "transitive_dependents": result.transitive_dependents
        },
        warnings=result.warnings,
        should_proceed=result.should_proceed
    )
```

### Endpoint: Safe Rename

```python
@router.post("/api/v1/refactoring/rename")
async def safe_rename(
    request: SafeRenameRequest,
    auth: str = Depends(verify_auth)
) -> SafeRenameResponse:
    """
    Rename a symbol across multiple files.
    """
    from src.refactoring.rename_engine import RenameEngine
    
    project_root = get_project_root(request.company, request.project)
    
    engine = RenameEngine(
        request.company,
        request.project,
        project_root
    )
    
    result = engine.rename(
        symbol_name=request.old_name,
        new_name=request.new_name,
        dry_run=request.dry_run,
        scope=request.scope
    )
    
    return SafeRenameResponse(
        status=result.status,
        files_affected=result.files_affected,
        total_edits=result.total_edits,
        graph_edits=result.graph_edits,
        text_search_edits=result.text_search_edits,
        edits=[
            {
                "file_path": e.file_path,
                "line_number": e.line_number,
                "old_text": e.old_text,
                "new_text": e.new_text,
                "source": e.source.value,
                "confidence": e.confidence,
                "reason": e.reason
            }
            for e in result.edits
        ],
        warnings=result.warnings
    )
```

### Endpoint: Check Staleness

```python
@router.get("/api/v1/dependency-graph/{company}/{project}/staleness")
async def check_staleness(
    company: str,
    project: str,
    auth: str = Depends(verify_auth)
) -> StalenessResponse:
    """
    Check if dependency graph is up-to-date.
    """
    from src.refactoring.staleness_tracker import StalenessTracker
    
    project_root = get_project_root(company, project)
    
    tracker = StalenessTracker(company, project, project_root)
    status = tracker.check_staleness()
    
    return StalenessResponse(
        is_stale=status.is_stale,
        indexed_commit=status.indexed_commit,
        current_commit=status.current_commit,
        commits_behind=status.commits_behind,
        recommendation=status.recommendation
    )
```

---

## 8. Implementation Tasks

### Phase 1: Git Integration (Week 1)

**Task 1.1: GitRepository Class**
- [ ] Implement git diff parsing
- [ ] Handle all diff scopes (staged, unstaged, all, commit)
- [ ] Parse hunk headers and line ranges
- [ ] Unit tests with fixture diffs

**Task 1.2: DiffHunk & FileDiff Models**
- [ ] Dataclasses for structured diff data
- [ ] affected_lines property
- [ ] Tests

### Phase 2: Change Detection (Week 2)

**Task 2.1: ChangeDetector Class**
- [ ] Map diff hunks to graph symbols
- [ ] Infer change types (modified/added/deleted)
- [ ] Run impact analysis per symbol
- [ ] Aggregate results
- [ ] Risk assessment
- [ ] Warning generation
- [ ] Integration tests

**Task 2.2: Change Detection API**
- [ ] POST /api/v1/refactoring/detect-changes endpoint
- [ ] Request/response models
- [ ] Tests

### Phase 3: Rename Engine (Week 3)

**Task 3.1: RenameEngine Class**
- [ ] Graph-based rename (follow edges)
- [ ] Text-based rename (grep fallback)
- [ ] Edit deduplication
- [ ] Dry-run mode
- [ ] Apply edits (file I/O)
- [ ] Unit tests

**Task 3.2: Rename API**
- [ ] POST /api/v1/refactoring/rename endpoint
- [ ] Tests

### Phase 4: Staleness Tracking (Week 4)

**Task 4.1: StalenessTracker Class**
- [ ] Compare graph commit to HEAD
- [ ] Count commits behind
- [ ] Update metadata on rebuild
- [ ] Tests

**Task 4.2: Staleness API**
- [ ] GET /api/v1/dependency-graph/{company}/{project}/staleness
- [ ] Tests

### Phase 5: Haikai Skills (Week 5)

**Task 5.1: /detect-changes Skill**
- [ ] SKILL.md
- [ ] Executor implementation
- [ ] Tests

**Task 5.2: /safe-rename Skill**
- [ ] SKILL.md
- [ ] Executor
- [ ] Tests

**Task 5.3: /check-staleness Skill**
- [ ] SKILL.md
- [ ] Executor
- [ ] Tests

### Phase 6: Integration (Week 6)

**Task 6.1: Hook Integration**
- [ ] Pre-commit hook option (auto detect-changes)
- [ ] Post-commit hook option (auto rebuild graph)
- [ ] Configuration

**Task 6.2: Documentation**
- [ ] User guide
- [ ] API docs
- [ ] Workflow examples

---

## 9. Testing Strategy

### Unit Tests

```python
# tests/refactoring/test_change_detector.py

def test_map_changes_to_symbols():
    """Test mapping git hunks to graph symbols."""
    # Given: A file with 2 symbols
    # When: Hunk modifies lines 15-20
    # Then: Symbol at lines 15-25 is marked as modified

def test_infer_change_type_added():
    """Test detecting newly added symbols."""
    # Given: Hunk with only '+' lines
    # Then: change_type = SYMBOL_ADDED

def test_infer_change_type_deleted():
    """Test detecting deleted symbols."""
    # Given: Hunk with only '-' lines
    # Then: change_type = SYMBOL_DELETED

def test_risk_assessment_high():
    """Test high risk detection."""
    # Given: 15 changed symbols, 50 dependents, 3 processes
    # Then: risk_level = HIGH
```

```python
# tests/refactoring/test_rename_engine.py

def test_graph_based_rename():
    """Test renaming via dependency graph."""
    # Given: funcA with 3 CALLS edges
    # When: Rename funcA to funcB
    # Then: 4 edits (1 definition + 3 call sites)

def test_text_based_rename():
    """Test text search fallback."""
    # Given: funcA mentioned in README
    # When: Text search enabled
    # Then: README edit found with confidence=0.5

def test_dry_run_no_changes():
    """Test dry-run doesn't modify files."""
    # Given: Rename in dry-run mode
    # Then: No files modified on disk
```

### Integration Tests

```python
# tests/integration/test_refactoring_pipeline.py

def test_detect_then_rename():
    """Test full workflow: detect changes, then rename."""
    # 1. Make code changes
    # 2. Run detect-changes
    # 3. See affected symbols
    # 4. Run safe-rename
    # 5. Verify all references updated
```

---

## 10. Safety Guardrails

### Automated Checks

1. **Pre-Commit Hook**
   ```bash
   # .git/hooks/pre-commit
   #!/bin/bash
   
   # Run change detection
   curl -X POST http://localhost:8000/api/v1/refactoring/detect-changes \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"company": "acme", "project": "backend", "scope": "staged"}'
   
   # Parse risk level
   # If HIGH or CRITICAL, prompt user to confirm
   ```

2. **Staleness Warning**
   - Show warning banner in API responses if graph is stale
   - Auto-suggest rebuild

3. **Rename Safety**
   - Always default to dry-run
   - Require explicit `--apply` flag
   - Show diff before applying

### Manual Checklists

**Before Large Refactor:**
- [ ] Run `/detect-changes` to see current state
- [ ] Run `/check-staleness` to ensure graph is current
- [ ] Create feature branch
- [ ] Run tests before changes

**After Refactor:**
- [ ] Run `/detect-changes` to see impact
- [ ] Review all warnings
- [ ] Run `/safe-rename` in dry-run mode
- [ ] Review proposed edits carefully
- [ ] Apply rename with `--apply`
- [ ] Run tests
- [ ] Commit with descriptive message

---

**End of Spec 2**
