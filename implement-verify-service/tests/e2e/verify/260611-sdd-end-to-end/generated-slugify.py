"""Slugify utility for converting text to URL-safe slugs."""

import re
import unicodedata
from typing import Optional


def slugify(text: str, max_length: Optional[int] = None) -> str:
    """
    Convert text to a URL-safe slug.

    Normalizes Unicode, lowercases, collapses non-alphanumeric runs to hyphens,
    and optionally truncates to a maximum length.

    Args:
        text: The text to slugify. Must be a string.
        max_length: Optional maximum length for the slug. If provided, the result
                   will be truncated to this length without leaving a trailing hyphen.

    Returns:
        A URL-safe slug string. Returns empty string for empty, whitespace-only,
        or all-symbol inputs.

    Raises:
        TypeError: If text is None.

    Examples:
        >>> slugify("Hello World")
        'hello-world'
        >>> slugify("Café")
        'cafe'
        >>> slugify("hello-world-test", max_length=11)
        'hello-world'
    """
    # Task 1.3: Guard against None input
    if text is None:
        raise TypeError('text must be str')

    # Task 1.4: Unicode normalization and ASCII-folding
    # Decompose Unicode characters using NFKD normalization
    normalized = unicodedata.normalize('NFKD', text)

    # Filter out combining marks (category 'Mn') to produce ASCII equivalents
    ascii_text = ''.join(
        char for char in normalized
        if unicodedata.category(char) != 'Mn'
    )

    # Task 1.5: Case normalization
    lowercased = ascii_text.lower()

    # Task 1.6: Collapse runs of non-alphanumeric characters to single hyphen
    # Pattern matches any run of one or more non-alphanumeric characters
    slug = re.sub(r'[^a-z0-9]+', '-', lowercased)

    # Task 1.7: Trim leading and trailing hyphens
    slug = slug.lstrip('-').rstrip('-')

    # Task 1.8: Max length truncation
    if max_length is not None and len(slug) > max_length:
        # Hard-truncate at character position max_length
        slug = slug[:max_length]
        # Strip any trailing hyphen that may have been exposed
        slug = slug.rstrip('-')

    # Task 1.9: Empty result handling is implicit
    # After all transformations, empty/whitespace/all-symbol inputs become ''

    return slug
