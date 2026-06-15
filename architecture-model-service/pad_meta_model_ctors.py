"""
Find every test file using new MetaModelEntitiesDto(...) or new MetaModelRelationshipsDto(...)
that passes fewer args than the production records, and append List.of()-padding to match.
"""
import re
from pathlib import Path

ENTITIES_TARGET = 51
RELS_TARGET = 19


def find_matching_close(text, open_pos):
    depth = 0
    i = open_pos
    n = len(text)
    while i < n:
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        elif c == '"':
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\":
                    i += 1
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 1
        i += 1
    return -1


def count_top_args(text, open_paren, close_paren):
    # If the body is empty / whitespace only -> 0 args
    body = text[open_paren + 1:close_paren]
    if body.strip() == "":
        return 0
    depth = 0
    args = 1
    i = open_paren + 1
    n = close_paren
    while i < n:
        c = text[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == '"':
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\":
                    i += 1
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 1
        elif c == "," and depth == 0:
            args += 1
        i += 1
    return args


def patch_constructor(text, ctor_name, target_count):
    pattern = re.compile(r"new\s+" + re.escape(ctor_name) + r"\b")
    out = []
    pos = 0
    while True:
        m = pattern.search(text, pos)
        if not m:
            out.append(text[pos:])
            break
        out.append(text[pos:m.end()])
        i = m.end()
        while i < len(text) and text[i] in " \t\n":
            i += 1
        if i >= len(text) or text[i] != "(":
            pos = m.end()
            continue
        open_p = i
        close_p = find_matching_close(text, open_p)
        if close_p == -1:
            pos = open_p + 1
            continue
        current = count_top_args(text, open_p, close_p)
        if 0 < current < target_count:
            missing = target_count - current
            # We need to insert `, List.of(), List.of(), ...` before the closing ')'.
            # The closing ')' may be preceded by whitespace (often a newline + spaces).
            # Find the last non-whitespace character before close_p.
            j = close_p - 1
            while j > open_p and text[j] in " \t\n":
                j -= 1
            inner_no_ws = text[open_p:j + 1]  # everything up to & including last non-ws char
            trailing_ws = text[j + 1:close_p]  # newline+indent before ')'
            # If last non-ws is already a comma, don't add a leading comma
            sep = ", " if not inner_no_ws.endswith(",") else " "
            pad = "List.of()" + (", List.of()" * (missing - 1))
            out.append(inner_no_ws)
            out.append(sep + pad)
            out.append(trailing_ws)
            out.append(")")
        else:
            out.append(text[open_p:close_p + 1])
        pos = close_p + 1
    return "".join(out)


def main():
    test_root = Path("src/test/java/com/example/architecturemodel")
    modified = []
    for jf in test_root.rglob("*.java"):
        text = jf.read_text(encoding="utf-8")
        new = patch_constructor(text, "MetaModelEntitiesDto", ENTITIES_TARGET)
        new = patch_constructor(new, "MetaModelRelationshipsDto", RELS_TARGET)
        if new != text:
            jf.write_text(new, encoding="utf-8")
            modified.append(str(jf.relative_to("src/test/java")))
    print("Modified files:")
    for f in modified:
        print(f"  {f}")


if __name__ == "__main__":
    main()
