"""AST Analysis Strategy — LLM-as-interpreter, not LLM-as-parser.

Instead of sending raw source code to the LLM, this strategy sends
compact structural output from ctags + tree-sitter. The LLM shifts from
parsing syntax to interpreting pre-parsed structure.

Supports two modes:
  1. Structural + LLM: deterministic sections + LLM interpretation
  2. Deterministic-only: zero LLM calls, pure structural output

Token reduction: ~90-99% vs raw code strategies.
"""
import json
import logging
import os
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional

from .base_global_strategy import BaseGlobalStandardStrategy, GlobalAnalysisContext
from .base_strategy import FileAnalysisContext
from ..ast.models import StructuralAnalysis, SymbolKind
from ..ast.formatter import format_structural_output
from ..ast.framework_detector import detect_frameworks, detect_languages
from ..ast.complexity_scorer import score_complexity, triage

logger = logging.getLogger(__name__)


# ── Prompts ──────────────────────────────────────────────────────────────

STRUCTURAL_SYSTEM_PROMPT = """\
You are a technical architect interpreting pre-parsed structural analysis data.
You are NOT reading raw source code. The data below was extracted by ctags and \
tree-sitter — it contains symbols, call graphs, imports, and inheritance \
relationships.

Your task: interpret the structural data to identify coding conventions, \
architectural patterns, and quality standards. Focus on what the STRUCTURE \
reveals — naming patterns, dependency direction, abstraction layers, \
consistency across the codebase.

Do not comment on syntax or formatting — you cannot see the actual code. \
Only reason about the structural relationships."""

STRUCTURAL_CONTEXT_PROMPT = """\
Analyze this structural summary of a codebase and identify conventions:

LANGUAGES: {languages}
FRAMEWORKS: {frameworks}

STRUCTURAL SUMMARY:
- Total files: {total_files}
- Total symbols: {total_symbols} ({symbol_breakdown})
- Total call edges: {total_calls}
- Total imports: {total_imports}
- Inheritance chains: {inheritance_count}

TOP IMPORTED MODULES:
{top_imports}

CALL GRAPH HOTSPOTS (most-called targets):
{call_hotspots}

INHERITANCE TREES:
{inheritance_trees}

Based on this structural data, provide a JSON object with:
{{
  "tech_stack": "brief description",
  "languages": ["list"],
  "frameworks": ["list"],
  "baseline_practices": ["common patterns you see"],
  "distinctive_patterns_to_look_for": ["interesting structural patterns"],
  "filtering_guidance": "what to focus on vs ignore"
}}"""

STRUCTURAL_EXTRACTION_SYSTEM = """\
You are interpreting pre-parsed structural data for a single file. \
The data shows symbols, calls, imports, and inheritance — not raw code.

Identify: naming conventions, dependency patterns, abstraction quality, \
error handling patterns (from method names and call targets), and any \
architectural concerns visible in the structure."""

STRUCTURAL_EXTRACTION_USER = """\
CODEBASE CONTEXT:
{context_json}

FILE: {file_path}

STRUCTURAL DATA:
{structural_content}

What conventions and standards does this file's structure reveal? \
Focus on patterns that should be documented as coding standards. \
Return a JSON object with your analysis."""


class AstAnalysisStrategy(BaseGlobalStandardStrategy):
    """Strategy that sends structural data to LLM instead of raw code.

    When ``deterministic_only`` is True, no LLM calls are made — the strategy
    produces a pure structural standards document from the analysis data.
    """

    def __init__(self, llm_client=None, content_extractor=None, *,
                 deterministic_only: bool = False,
                 triage_threshold: float = 0.3):
        if not deterministic_only:
            super().__init__(llm_client, content_extractor)
        else:
            # Skip parent init that requires llm_client
            self.llm_client = None
            self.content_extractor = None
            self.context = None
        self.deterministic_only = deterministic_only
        self.triage_threshold = triage_threshold
        self._structural_results: Dict[str, StructuralAnalysis] = {}

    def get_standard_name(self) -> str:
        return "structural_analysis"

    # ── Pass 1: Build context from structural data ────────────────────

    def build_context_from_structural(
        self,
        structural_results: Dict[str, StructuralAnalysis],
    ) -> GlobalAnalysisContext:
        """Build context deterministically from structural analysis.

        This replaces ``build_context_from_samples()`` which reads random
        raw code files.  Here we use the already-computed structural data.
        """
        self._structural_results = structural_results

        # Deterministic: languages, frameworks, symbol stats
        languages = detect_languages(structural_results)
        frameworks = detect_frameworks(structural_results)
        deterministic = self.build_deterministic_sections(structural_results)

        lang_list = [lang for lang, _ in languages]
        fw_list = [f.name for f in frameworks]

        if self.deterministic_only or not self.llm_client:
            # Pure structural context — no LLM call
            self.context = GlobalAnalysisContext(
                standard_name=self.get_standard_name(),
                tech_stack=", ".join(fw_list[:3]) if fw_list else "Unknown",
                languages=lang_list,
                frameworks=fw_list,
                baseline_practices=deterministic.get("baseline_practices", []),
                distinctive_patterns_to_look_for=deterministic.get("distinctive_patterns", []),
                filtering_guidance="Focus on structural patterns, skip trivial files",
            )
            return self.context

        # Structural + LLM: send summary to LLM for semantic interpretation
        prompt = STRUCTURAL_CONTEXT_PROMPT.format(
            languages=", ".join(lang_list),
            frameworks=", ".join(fw_list) or "None detected",
            total_files=len(structural_results),
            total_symbols=deterministic["total_symbols"],
            symbol_breakdown=deterministic["symbol_breakdown"],
            total_calls=deterministic["total_calls"],
            total_imports=deterministic["total_imports"],
            inheritance_count=deterministic["inheritance_count"],
            top_imports=deterministic["top_imports_text"],
            call_hotspots=deterministic["call_hotspots_text"],
            inheritance_trees=deterministic["inheritance_trees_text"],
        )

        messages = [
            {"role": "system", "content": STRUCTURAL_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        try:
            response = self.llm_client.generate(messages)
            context_dict = json.loads(response)
            self.context = GlobalAnalysisContext(
                standard_name=self.get_standard_name(),
                tech_stack=context_dict.get("tech_stack", ""),
                languages=context_dict.get("languages", lang_list),
                frameworks=context_dict.get("frameworks", fw_list),
                baseline_practices=context_dict.get("baseline_practices", []),
                distinctive_patterns_to_look_for=context_dict.get(
                    "distinctive_patterns_to_look_for", []
                ),
                filtering_guidance=context_dict.get("filtering_guidance", ""),
            )
        except Exception as e:
            logger.warning(f"LLM context call failed, using deterministic: {e}")
            self.context = GlobalAnalysisContext(
                standard_name=self.get_standard_name(),
                tech_stack=", ".join(fw_list[:3]),
                languages=lang_list,
                frameworks=fw_list,
                baseline_practices=deterministic.get("baseline_practices", []),
                distinctive_patterns_to_look_for=[],
                filtering_guidance="",
            )

        return self.context

    # ── Triage ────────────────────────────────────────────────────────

    def triage_files(
        self, structural_results: Dict[str, StructuralAnalysis]
    ) -> Tuple[List[str], List[str]]:
        """Split files into SKIP (no LLM) and ANALYZE (send to LLM)."""
        return triage(structural_results, self.triage_threshold)

    # ── Pass 2: Extraction prompts (structural, not raw code) ─────────

    def get_extraction_prompts(
        self, file_path: str, content: str, is_documentation: bool
    ) -> Tuple[str, str]:
        """Return prompts that send structural output, not raw code.

        ``content`` is expected to be the formatted structural output
        (from ``format_structural_output()``), not raw source code.
        """
        user_prompt = STRUCTURAL_EXTRACTION_USER.format(
            context_json=self.context.to_json() if self.context else "{}",
            file_path=file_path,
            structural_content=content,
        )
        return (STRUCTURAL_EXTRACTION_SYSTEM, user_prompt)

    # ── Deterministic sections ────────────────────────────────────────

    def build_deterministic_sections(
        self, structural_results: Dict[str, StructuralAnalysis]
    ) -> Dict[str, Any]:
        """Build pure structural analysis sections — no LLM needed.

        These sections are always deterministic: same code → same output.
        """
        total_symbols = 0
        kind_counts: Counter = Counter()
        total_calls = 0
        total_imports = 0
        inheritance_count = 0
        import_counter: Counter = Counter()
        callee_counter: Counter = Counter()
        inheritance_entries: list = []
        baseline_practices: list = []

        for analysis in structural_results.values():
            for sym in (analysis.symbols or []):
                total_symbols += 1
                kind_counts[sym.kind] += 1

            for call in (analysis.calls or []):
                total_calls += 1
                callee_counter[call.callee_name] += 1

            for imp in (analysis.imports or []):
                total_imports += 1
                import_counter[imp.module] += 1

            for inh in (analysis.inheritance or []):
                inheritance_count += 1
                bases = ", ".join(inh.bases) if inh.bases else "?"
                inheritance_entries.append(f"{inh.class_name} → {bases}")

        # Symbol breakdown
        symbol_breakdown = ", ".join(
            f"{count} {kind}" for kind, count in kind_counts.most_common()
        )

        # Top imports
        top_imports = "\n".join(
            f"  {mod}: {count} files"
            for mod, count in import_counter.most_common(15)
        )

        # Call hotspots
        call_hotspots = "\n".join(
            f"  {callee}: {count} calls"
            for callee, count in callee_counter.most_common(15)
        )

        # Inheritance trees
        inheritance_trees = "\n".join(
            f"  {entry}" for entry in inheritance_entries[:20]
        )

        # Infer baseline practices from structural patterns
        if kind_counts.get(SymbolKind.CLASS, 0) > 5:
            baseline_practices.append("Object-oriented design (class-based)")
        if inheritance_count > 3:
            baseline_practices.append("Inheritance-based polymorphism")
        async_methods = sum(
            1 for a in structural_results.values()
            for s in (a.symbols or [])
            if getattr(s, "is_async", False)
        )
        if async_methods > 5:
            baseline_practices.append("Async/await concurrency pattern")
        if total_calls > 50:
            baseline_practices.append("High inter-module coupling (many call edges)")

        # Distinctive patterns
        distinctive = []
        frameworks = detect_frameworks(structural_results)
        if any(f.category == "orm" for f in frameworks):
            distinctive.append("ORM-based data access layer")
        if any(f.category == "web" for f in frameworks):
            distinctive.append("Web framework with endpoint routing")
        if any(f.category == "testing" for f in frameworks):
            distinctive.append("Test framework integration")

        return {
            "total_symbols": total_symbols,
            "symbol_breakdown": symbol_breakdown,
            "total_calls": total_calls,
            "total_imports": total_imports,
            "inheritance_count": inheritance_count,
            "top_imports_text": top_imports or "  (none)",
            "call_hotspots_text": call_hotspots or "  (none)",
            "inheritance_trees_text": inheritance_trees or "  (none)",
            "baseline_practices": baseline_practices,
            "distinctive_patterns": distinctive,
            "kind_counts": dict(kind_counts),
            "top_imports": import_counter.most_common(15),
            "top_callees": callee_counter.most_common(15),
            "inheritance_entries": inheritance_entries,
        }

    # ── Deterministic-only synthesis ──────────────────────────────────

    def synthesize_deterministic(
        self, structural_results: Dict[str, StructuralAnalysis]
    ) -> str:
        """Generate a standards document with zero LLM calls.

        Pure structural analysis output — dependency graphs, symbol stats,
        framework detection, triage results.
        """
        sections = self.build_deterministic_sections(structural_results)
        languages = detect_languages(structural_results)
        frameworks = detect_frameworks(structural_results)
        skip_files, analyze_files = self.triage_files(structural_results)

        lines = [
            "# Structural Analysis Standards",
            "",
            "## Overview",
            "",
            f"- **Files analyzed:** {len(structural_results)}",
            f"- **Total symbols:** {sections['total_symbols']} ({sections['symbol_breakdown']})",
            f"- **Total call edges:** {sections['total_calls']}",
            f"- **Total imports:** {sections['total_imports']}",
            f"- **Inheritance chains:** {sections['inheritance_count']}",
            "",
            "## Languages",
            "",
        ]
        for lang, count in languages:
            lines.append(f"- {lang}: {count} files")

        lines += ["", "## Frameworks & Libraries", ""]
        if frameworks:
            for fw in frameworks:
                lines.append(
                    f"- **{fw.name}** ({fw.category}) — {fw.import_count} files, "
                    f"confidence {fw.confidence}"
                )
        else:
            lines.append("- No frameworks detected")

        lines += ["", "## Dependency Graph (Top 15 Imports)", ""]
        lines.append("| Module | Files |")
        lines.append("|--------|------:|")
        for mod, count in sections["top_imports"]:
            lines.append(f"| {mod} | {count} |")

        lines += ["", "## Call Graph Hotspots (Top 15)", ""]
        lines.append("| Target | Calls |")
        lines.append("|--------|------:|")
        for callee, count in sections["top_callees"]:
            lines.append(f"| {callee} | {count} |")

        lines += ["", "## Inheritance", ""]
        for entry in sections["inheritance_entries"][:20]:
            lines.append(f"- {entry}")

        lines += ["", "## Triage Summary", ""]
        lines.append(f"- **Trivial files (SKIP):** {len(skip_files)}")
        lines.append(f"- **Complex files (ANALYZE):** {len(analyze_files)}")
        if analyze_files:
            lines.append("")
            lines.append("Complex files:")
            for f in sorted(analyze_files):
                score = score_complexity(structural_results[f])
                lines.append(f"- `{f}` (complexity: {score})")

        lines += ["", "## Structural Practices", ""]
        for practice in sections["baseline_practices"]:
            lines.append(f"- {practice}")

        lines.append("")
        return "\n".join(lines)

    # ── Override synthesize for LLM mode ──────────────────────────────

    def synthesize(self, llm_client, providers: List[Dict[str, Any]]) -> str:
        """Synthesize standards from structural + LLM analyses.

        Merges deterministic structural sections with LLM interpretations.
        """
        if self.deterministic_only:
            return self.synthesize_deterministic(self._structural_results)

        # Combine deterministic sections + LLM synthesis
        deterministic_doc = self.synthesize_deterministic(self._structural_results)

        system_prompt = (
            "You are a technical architect synthesizing coding standards.\n"
            "Below is a deterministic structural analysis of the codebase, "
            "followed by per-file LLM interpretations.\n"
            "Merge these into a single cohesive standards document.\n"
            "Keep the structural data tables. Add conventions and recommendations "
            "from the interpretations.\n"
            "Return ONLY the final Markdown."
        )

        user_prompt = (
            f"=== STRUCTURAL ANALYSIS ===\n{deterministic_doc}\n\n"
            f"=== LLM INTERPRETATIONS ({len(providers)} files) ===\n"
            f"{json.dumps(providers, indent=2)}\n"
        )

        return llm_client.generate([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ])
