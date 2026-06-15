"""Structural diff computation between two snapshots.

Compares _index.txt and _inheritance.txt between snapshots to produce
a grepable _diff.txt file.
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class StructuralDiff:
    """Compute structural differences between two analysis snapshots."""

    def generate_diff(self, prev_path: Path, current_path: Path) -> str:
        """Generate _diff.txt comparing prev_path to current_path.

        Returns the diff content as a string and writes to current_path/_diff.txt.
        """
        prev_index = self._read_index(prev_path)
        curr_index = self._read_index(current_path)
        prev_inheritance = self._read_inheritance(prev_path)
        curr_inheritance = self._read_inheritance(current_path)
        prev_imports = self._read_imports(prev_path)
        curr_imports = self._read_imports(current_path)

        prev_sha = prev_path.name
        curr_sha = current_path.name
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")

        # Build symbol keys: (file, kind, name, scope)
        prev_symbols = {}
        for entry in prev_index:
            key = (entry["file"], entry["kind"], entry["name"], entry["scope"])
            prev_symbols[key] = entry

        curr_symbols = {}
        for entry in curr_index:
            key = (entry["file"], entry["kind"], entry["name"], entry["scope"])
            curr_symbols[key] = entry

        prev_keys = set(prev_symbols.keys())
        curr_keys = set(curr_symbols.keys())

        added = curr_keys - prev_keys
        removed = prev_keys - curr_keys
        common = prev_keys & curr_keys

        # Detect modified signatures
        modified = []
        for key in common:
            prev_sig = prev_symbols[key].get("signature", "-")
            curr_sig = curr_symbols[key].get("signature", "-")
            if prev_sig != curr_sig:
                modified.append((key, prev_sig, curr_sig))

        # Inheritance changes
        prev_inh_set = {(r["child"], r["rel"], r["parent"]) for r in prev_inheritance}
        curr_inh_set = {(r["child"], r["rel"], r["parent"]) for r in curr_inheritance}
        added_inh = curr_inh_set - prev_inh_set
        removed_inh = prev_inh_set - curr_inh_set

        # Import changes
        prev_imp_set = {(r["file"], r["module"]) for r in prev_imports}
        curr_imp_set = {(r["file"], r["module"]) for r in curr_imports}
        added_imp = curr_imp_set - prev_imp_set
        removed_imp = prev_imp_set - curr_imp_set

        # Build output
        lines = [
            f"Diff: {prev_sha} \u2192 {curr_sha}",
            f"Date: {now}",
            "",
        ]

        if added:
            lines.append("Added Symbols:")
            for key in sorted(added):
                file, kind, name, scope = key
                lines.append(f"  {file}\t{kind}\t{name}\t{scope}")
            lines.append("")

        if removed:
            lines.append("Removed Symbols:")
            for key in sorted(removed):
                file, kind, name, scope = key
                lines.append(f"  {file}\t{kind}\t{name}\t{scope}")
            lines.append("")

        if modified:
            lines.append("Modified Signatures:")
            for key, prev_sig, curr_sig in sorted(modified):
                file, kind, name, scope = key
                lines.append(f"  {file}\t{kind}\t{name}\t{scope}\t{prev_sig} \u2192 {curr_sig}")
            lines.append("")

        if added_inh:
            lines.append("Added Inheritance:")
            for child, rel, parent in sorted(added_inh):
                lines.append(f"  {child} {rel} {parent}")
            lines.append("")

        if removed_inh:
            lines.append("Removed Inheritance:")
            for child, rel, parent in sorted(removed_inh):
                lines.append(f"  {child} {rel} {parent}")
            lines.append("")

        if added_imp:
            lines.append("Added Imports:")
            for file, module in sorted(added_imp):
                lines.append(f"  {file}\tnow imports\t{module}")
            lines.append("")

        if removed_imp:
            lines.append("Removed Imports:")
            for file, module in sorted(removed_imp):
                lines.append(f"  {file}\tno longer imports\t{module}")
            lines.append("")

        # Summary
        lines.append("Summary:")
        parts = []
        if added:
            parts.append(f"+{len(added)} symbols")
        if removed:
            parts.append(f"-{len(removed)} symbols")
        if modified:
            parts.append(f"{len(modified)} signature changes")
        if added_inh:
            parts.append(f"+{len(added_inh)} inheritance")
        if removed_inh:
            parts.append(f"-{len(removed_inh)} inheritance")
        if added_imp:
            parts.append(f"+{len(added_imp)} imports")
        if removed_imp:
            parts.append(f"-{len(removed_imp)} imports")
        if parts:
            lines.append(f"  {', '.join(parts)}")
        else:
            lines.append("  No structural changes")

        content = "\n".join(lines) + "\n"

        # Write to current snapshot
        diff_file = current_path / "_diff.txt"
        diff_file.write_text(content, encoding="utf-8")
        logger.info(f"Structural diff written: {diff_file}")

        return content

    def _read_index(self, snapshot_path: Path) -> list[dict]:
        """Read _index.txt into list of dicts."""
        index_file = snapshot_path / "_index.txt"
        if not index_file.exists():
            return []
        entries = []
        for line in index_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) >= 7:
                entries.append({
                    "file": parts[0],
                    "kind": parts[1],
                    "name": parts[2],
                    "scope": parts[3],
                    "signature": parts[4],
                    "line": parts[5],
                    "flags": parts[6],
                })
        return entries

    def _read_inheritance(self, snapshot_path: Path) -> list[dict]:
        """Read _inheritance.txt into list of dicts."""
        inh_file = snapshot_path / "_inheritance.txt"
        if not inh_file.exists():
            return []
        entries = []
        for line in inh_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) >= 4:
                entries.append({
                    "child": parts[0],
                    "rel": parts[1],
                    "parent": parts[2],
                    "file": parts[3],
                })
        return entries

    def _read_imports(self, snapshot_path: Path) -> list[dict]:
        """Read _imports.txt into list of dicts."""
        imp_file = snapshot_path / "_imports.txt"
        if not imp_file.exists():
            return []
        entries = []
        for line in imp_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) >= 3:
                entries.append({
                    "file": parts[0],
                    "module": parts[1],
                    "names": parts[2],
                })
        return entries
