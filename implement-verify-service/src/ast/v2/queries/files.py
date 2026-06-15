"""Filesystem walker for repos. Used for page-based routing detection later."""
from dataclasses import dataclass
from pathlib import Path


@dataclass
class FileMeta:
    path: str          # relative to project_root, with forward slashes
    ext: str
    depth: int
    parent_dir: str
    bytes: int


class FilesQuery:
    """Walk a project root, return per-file metadata.

    Used by page-based routing playbooks (e.g. mantisbt: each *.php at root is an endpoint).
    """

    DEFAULT_IGNORE_DIRS = {
        ".git", "node_modules", "vendor", "__pycache__",
        ".venv", "venv", "target", "build", "dist", ".idea", ".vscode",
    }

    def __init__(self, project_root: str | Path, ignore_dirs: set[str] | None = None):
        self._root = Path(project_root)
        self._ignore = ignore_dirs or self.DEFAULT_IGNORE_DIRS

    def walk(self, ext: str | None = None, depth_le: int | None = None) -> list[FileMeta]:
        """Return files under the project root, optionally filtered by extension and max depth."""
        root = self._root
        out: list[FileMeta] = []
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            try:
                rel = path.relative_to(root)
            except ValueError:
                continue
            parts = rel.parts
            if any(p in self._ignore for p in parts):
                continue
            depth = len(parts) - 1
            if depth_le is not None and depth > depth_le:
                continue
            file_ext = path.suffix.lstrip(".").lower()
            if ext is not None and file_ext != ext.lower().lstrip("."):
                continue
            try:
                size = path.stat().st_size
            except OSError:
                size = 0
            out.append(FileMeta(
                path=str(rel).replace("\\", "/"),
                ext=file_ext,
                depth=depth,
                parent_dir=parts[-2] if depth > 0 else "",
                bytes=size,
            ))
        return out
