"""Shared question parser for chat executors.

Parses questions from buffered assistant content after `/ask-questions`
invocation. Each chat executor (Claude / Kiro / OAuth / OpenAI) used to ship
its own near-identical copy; the OpenAI copy was missing Pattern 2 (the
colon-separated format the CLI Skill tool actually emits), causing a silent
"zero questions returned" bug on the OpenAI backend.

This module is the single source of truth. The 4 executors now delegate to
`parse_questions(...)`.

Supported formats (tried in order; the first matching pattern wins):

1. Bracket IDs:  `- [uuid] Question text`
2. Colon IDs:    `- q1: Question text`        (CLI Skill tool emits this)
3. Numbered:     `**1.** Question text`  /  `**Q1:** ...`  /  `**Question 1:** ...`
4. Plain numbered: `1. Question text`         (Kiro CLI sometimes emits this)
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


def parse_questions(content_chunks: list[str]) -> list[dict]:
    """Parse questions from buffered assistant content chunks.

    Args:
        content_chunks: Text chunks streamed back from the model.

    Returns:
        List of `{"id": str, "question": str}` dicts. Empty list if no
        pattern matches.
    """
    # Join with newlines so line-start anchors and `\n`-based lookaheads
    # work even when consecutive list items arrived in separate chunks.
    full_content = "\n".join(content_chunks)
    questions: list[dict] = []

    # Pattern 1: Markdown list with IDs in brackets — `- [uuid] Question text`
    pattern1 = r'-\s*\[([^\]]+)\]\s*(.+?)(?=\n-\s*\[|$)'
    matches1 = re.findall(pattern1, full_content, re.DOTALL)
    if matches1:
        for qid, qtext in matches1:
            qtext = qtext.strip()
            if qtext:
                questions.append({"id": qid.strip(), "question": qtext})
        if questions:
            logger.debug("Parsed %d questions using bracket format [id]", len(questions))
            return questions

    # Pattern 2: Markdown list with colon-separated IDs — `- q1: Question text`
    # This is the format the Claude CLI Skill tool emits in its args field.
    pattern2 = r'-\s*([a-zA-Z0-9_-]+):\s*(.+?)(?=\n-\s*[a-zA-Z0-9_-]+:|$)'
    matches2 = re.findall(pattern2, full_content, re.DOTALL)
    if matches2:
        for qid, qtext in matches2:
            qtext = qtext.strip()
            if qtext:
                questions.append({"id": qid.strip(), "question": qtext})
        if questions:
            logger.debug("Parsed %d questions using colon format id:", len(questions))
            return questions

    # Pattern 3: Numbered headings — `**1.** ...`  /  `**Q1:** ...`  /  `**Question 1:** ...`
    pattern3 = (
        r'\*\*(?:Q?\d+|Question\s+\d+)[.:]?\*\*\s*'
        r'(.+?)(?=\n\*\*(?:Q?\d+|Question\s+\d+)[.:]?\*\*|$)'
    )
    matches3 = re.findall(pattern3, full_content, re.DOTALL | re.IGNORECASE)
    if matches3:
        for idx, qtext in enumerate(matches3, 1):
            qtext = qtext.strip()
            # Skip section-header lines like "Existing Code Reuse:".
            if qtext and not qtext.endswith(':'):
                questions.append({"id": f"q{idx}", "question": qtext})
        if questions:
            logger.debug("Parsed %d questions using numbered format", len(questions))
            return questions

    # Pattern 4: Plain numbered list — `1. Question text`
    # Filter out short non-question lines (Kiro emits ToC-style numbers too).
    pattern4 = r'^\s*(\d+)\.\s+(.+?)$'
    matches4 = re.findall(pattern4, full_content, re.MULTILINE)
    if matches4:
        for num, qtext in matches4:
            qtext = qtext.strip()
            if qtext and len(qtext) > 10:
                questions.append({"id": f"q{num}", "question": qtext})
        if questions:
            logger.debug("Parsed %d questions using plain-numbered format", len(questions))
            return questions

    logger.debug("No questions found in content")
    return questions
