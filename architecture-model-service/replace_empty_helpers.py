"""
Replace test helper methods that construct empty MetaModelEntitiesDto/RelationshipsDto
with calls to TestMetaModelFactory. Targets the common patterns where all args are
Collections.emptyList() or List.of().
"""
import re
from pathlib import Path


def is_pure_empty(args_text: str, entity_count_min: int = 0) -> bool:
    """True if args_text contains only `Collections.emptyList()` / `List.of()` /
    `Collections.<Type>emptyList()` / `Collections.<Type>EMPTY_LIST` (no entity refs)."""
    # Strip comments and whitespace
    stripped = re.sub(r"//[^\n]*", "", args_text)
    stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.S)
    tokens = [t.strip() for t in stripped.split(",")]
    tokens = [t for t in tokens if t]
    if not tokens:
        return False
    if len(tokens) < entity_count_min:
        return False
    empty_pattern = re.compile(
        r"^(Collections\.<[^>]+>emptyList\(\)|Collections\.emptyList\(\)|List\.of\(\))$"
    )
    return all(empty_pattern.match(t) for t in tokens)


def replace_helper(text: str, helper_name: str, factory_call: str, target_type: str) -> tuple[str, bool]:
    """Find `private TARGET_TYPE helper_name(...) { return new TARGET_TYPE(...); }`
    and if body is all-empty, replace body with `return factory_call;`."""
    # naive: find return new TARGET_TYPE(...);
    pattern = re.compile(
        r"(private\s+" + re.escape(target_type) + r"\s+" + re.escape(helper_name) +
        r"\s*\([^)]*\)\s*\{\s*return\s+new\s+" + re.escape(target_type) + r"\s*\()([\s\S]*?)(\)\s*;\s*\})"
    )
    m = pattern.search(text)
    if not m:
        return text, False
    args_text = m.group(2)
    if not is_pure_empty(args_text):
        return text, False
    new_text = text[:m.start()] + (
        f"private {target_type} {helper_name}() {{\n"
        f"        return {factory_call};\n"
        f"    }}"
    ) + text[m.end():]
    return new_text, True


def main():
    test_root = Path("src/test/java/com/example/architecturemodel")
    modified = []
    for jf in test_root.rglob("*.java"):
        text = jf.read_text(encoding="utf-8")
        original = text
        # Try common helper names for entities
        for ename in ["createEmptyEntities", "emptyEntities", "buildEmptyEntities", "createEntities"]:
            text, ok = replace_helper(
                text, ename,
                "com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities()",
                "MetaModelEntitiesDto",
            )
            if ok:
                modified.append((str(jf.relative_to("src/test/java")), ename))
        for rname in ["createEmptyRelationships", "emptyRelationships", "buildEmptyRelationships", "createRelationships"]:
            text, ok = replace_helper(
                text, rname,
                "com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships()",
                "MetaModelRelationshipsDto",
            )
            if ok:
                modified.append((str(jf.relative_to("src/test/java")), rname))
        if text != original:
            jf.write_text(text, encoding="utf-8")
    print("Replaced:")
    for f, n in modified:
        print(f"  {f}: {n}")


if __name__ == "__main__":
    main()
