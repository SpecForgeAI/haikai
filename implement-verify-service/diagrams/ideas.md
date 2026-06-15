# SpecForge Architecture Diagrams — Design Ideas

<response>
<text>
**Design Movement:** Technical Blueprint / Dark IDE Aesthetic

**Core Principles:**
1. Dark canvas with high-contrast node colours — mirrors the feel of a professional IDE or architecture tool (Figma, Miro dark mode)
2. Monospace accents for labels and port numbers — reinforces the engineering context
3. Minimal chrome: the diagram is the hero, the UI shell is invisible
4. Colour-coded service categories (frontend = blue, gateway = emerald, core = violet, DB = amber, external = slate)

**Color Philosophy:**
- Background: near-black `#0f1117` (slate-950 equivalent)
- Canvas: `#141821` with subtle grid dot pattern
- Node fills: saturated but not neon — blue-600, emerald-600, violet-600, amber-500, slate-600
- Edges: `#334155` (slate-700) with animated dashes on hover
- Accent: electric blue `#3b82f6` for selections and active states

**Layout Paradigm:**
- Full-viewport canvas per diagram, no scrollable page
- Left sidebar: diagram switcher with icon + label per diagram
- Top bar: diagram title + description + controls (fit view, zoom in/out, minimap toggle)
- ReactFlow fills the remaining space

**Signature Elements:**
1. Dot-grid canvas background (CSS radial-gradient)
2. Rounded-rect nodes with a left-border colour accent stripe
3. Animated edge paths on hover (stroke-dashoffset animation)

**Interaction Philosophy:**
- Drag, pan, zoom are all native ReactFlow — no restrictions
- Clicking a node opens a detail tooltip/popover with description
- "Fit View" button always available

**Animation:**
- Nodes fade+scale in on diagram load (staggered 30ms)
- Edge paths draw in on load (stroke-dashoffset from full to 0)
- Sidebar diagram switch: crossfade the canvas

**Typography System:**
- Display: `Space Grotesk` (bold, geometric — for diagram titles and node labels)
- Mono: `JetBrains Mono` (for port numbers, IDs, code references)
- Body: `Inter` (for descriptions and sidebar text)
</text>
<probability>0.08</probability>
</response>

<response>
<text>
**Design Movement:** Clean Engineering Dashboard / Light Blueprint

**Core Principles:**
1. Off-white canvas with ink-blue nodes — professional, printable, presentation-ready
2. Strong typographic hierarchy using a slab serif for titles
3. Generous whitespace around the canvas; the diagram breathes
4. Subtle paper texture on the canvas background

**Color Philosophy:**
- Background: `#f8f9fc` (cool off-white)
- Canvas: `#ffffff` with light `#e2e8f0` grid lines
- Nodes: deep navy `#1e3a5f`, teal `#0d9488`, amber `#d97706`
- Edges: `#94a3b8` with directional arrows

**Layout Paradigm:**
- Top navigation tabs for diagram switching
- Full-width canvas below
- Floating toolbar (bottom-centre) for zoom/fit controls

**Signature Elements:**
1. Blueprint-style grid lines on canvas
2. Nodes with drop shadows and rounded corners
3. Category legend in top-right corner

**Interaction Philosophy:**
- Hover highlights connected edges
- Click node to highlight its subgraph

**Animation:**
- Smooth tab transitions
- Nodes slide in from centre on load

**Typography System:**
- Display: `Playfair Display` (slab serif for titles)
- Body: `Source Sans Pro`
- Mono: `Fira Code`
</text>
<probability>0.06</probability>
</response>

<response>
<text>
**Design Movement:** Cyberpunk Terminal / Neon on Dark

**Core Principles:**
1. Pure black background with neon accent colours
2. Glitch/scanline texture on canvas
3. Nodes styled as terminal windows with header bars
4. Edges rendered as neon laser lines

**Color Philosophy:**
- Background: `#000000`
- Neon accents: cyan `#00ffff`, magenta `#ff00ff`, yellow `#ffff00`
- Node backgrounds: `#111111` with neon border glow

**Layout Paradigm:**
- Fullscreen canvas, no sidebar
- Floating pill navigation at top

**Signature Elements:**
1. CRT scanline overlay (CSS repeating-linear-gradient)
2. Glowing node borders (box-shadow neon)
3. Animated edge pulses

**Interaction Philosophy:**
- Click to "hack" — node expands with terminal output
- Keyboard shortcuts for navigation

**Animation:**
- Nodes flicker in like a CRT boot
- Edges pulse with moving glow

**Typography System:**
- Display: `Share Tech Mono`
- Body: `VT323`
</text>
<probability>0.04</probability>
</response>

---

## Chosen Design

**Option 1: Technical Blueprint / Dark IDE Aesthetic** is selected.

This is the strongest fit for a professional architecture diagram tool — it mirrors the visual language of tools like Figma, Miro, and draw.io in dark mode. The colour-coded nodes make service categories instantly readable, the dot-grid canvas feels like a proper diagramming workspace, and the Space Grotesk + JetBrains Mono pairing gives it a crafted, engineering-forward identity.
