# Design Ideas — Repo Flow Diagram

## Design Philosophy Options

<response>
<text>
**Design Movement:** Technical Blueprint / Engineering Schematic
**Core Principles:**
- Dark background with high-contrast node labels — readability first
- Monospace typography for code-adjacent labels, sans-serif for headings
- Nodes styled as "cards" with a left-border accent colour per phase
- Edges as clean orthogonal arrows with subtle animated dashes

**Color Philosophy:** Dark slate (#0f1117) base, with two accent tracks:
- Mono track: cool blue (#3b82f6) for shared pipeline nodes
- Poly track: amber (#f59e0b) for the fan-out nodes unique to polyrepo

**Layout Paradigm:** Two vertical swim-lanes side by side (Mono | Poly), sharing a common top section (API layer) and diverging at the workspace layout node, then converging again at the orchestrator.

**Signature Elements:**
- Dashed animated edges on the polyrepo fan-out to signal "N times"
- A subtle grid dot background (engineering paper aesthetic)
- Pill badges on nodes showing file names (e.g. `models.py`, `projects.py`)

**Interaction Philosophy:** Click a node to expand a detail panel on the right showing what changes in that file for polyrepo vs mono. Hover highlights the edge path.

**Animation:** Nodes fade-in staggered on load (50ms apart). Edges draw in after nodes settle. No continuous animation except the dashed edge pulse on polyrepo fan-out.

**Typography System:** `JetBrains Mono` for node labels and code snippets; `Inter` (600) for section headings.
</text>
<probability>0.08</probability>
</response>

<response>
<text>
**Design Movement:** Minimal Whitespace / Documentation Style
**Core Principles:**
- White background, generous padding, subtle card shadows
- Nodes look like documentation cards with a top-coloured stripe
- Two columns with a clear vertical divider labelled "Mono" and "Poly"

**Color Philosophy:** Off-white (#fafafa) base. Mono nodes: slate-700. Poly fan-out nodes: emerald-600. Shared nodes: neutral-500.

**Layout Paradigm:** Top-down flow in two columns. Shared nodes span full width at top and bottom. Divergent nodes sit in their respective column.

**Signature Elements:**
- A "degenerate case" callout box between the two columns at the workspace level
- Node subtitles showing the file name being changed

**Interaction Philosophy:** Toggle button to highlight "what's new in polyrepo" — dims mono-only nodes, brightens poly-specific ones.

**Animation:** Simple fade-in on load. No edge animation.

**Typography System:** `Geist` for headings; `Geist Mono` for file labels.
</text>
<probability>0.07</probability>
</response>

<response>
<text>
**Design Movement:** Dark Terminal / IDE Theme
**Core Principles:**
- VSCode-dark palette — feels native to a developer tool
- Nodes styled as file tabs with language icons
- Edges styled as import arrows (like a dependency graph)

**Color Philosophy:** #1e1e2e base (Catppuccin Mocha). Mono: #89b4fa (blue). Poly: #a6e3a1 (green). Shared: #cdd6f4 (text).

**Layout Paradigm:** Radial from a central "POST /projects/init" node, branching left for mono and right for poly.

**Signature Elements:**
- File icons (Python, YAML) on nodes
- A "diff" badge on changed nodes showing +/- lines

**Interaction Philosophy:** Hover shows a mini code diff tooltip. Click opens a drawer with the full before/after.

**Animation:** Edges animate as a flowing gradient (like electricity) on hover.

**Typography System:** `Fira Code` throughout.
</text>
<probability>0.06</probability>
</response>

---

## Chosen Design

**Technical Blueprint / Engineering Schematic** (Option 1)

Two vertical swim-lanes, dark slate background, blue for mono track, amber for poly fan-out, animated dashed edges on the N-repos fan-out, JetBrains Mono for labels. Click a node to see what changes.
