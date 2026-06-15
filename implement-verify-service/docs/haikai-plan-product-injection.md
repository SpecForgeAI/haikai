# Haikai: What Gets Injected Into Claude During `plan-product`

## Injection Mechanism

The entry point is:

```
haikai-profiles/default/commands/plan-product/single-agent/plan-product.md
```

This orchestrates a **4-phase** sequential process — the most phases of any Haikai skill.

---

## What Gets Compiled Into the System Prompt

### Phase 1 — `1-product-concept.md`

Inlines:
- `{{workflows/planning/gather-product-info}}` — product info gathering workflow
- `{{standards/global/*}}` — all global standards (conditionally)

### Phase 2 — `2-create-mission.md`

Inlines:
- `{{workflows/planning/create-product-mission}}` — mission creation workflow
- `{{standards/global/*}}` — all global standards (conditionally)

### Phase 3 — `3-create-roadmap.md`

Inlines:
- `{{workflows/planning/create-product-roadmap}}` — roadmap creation workflow
- `{{standards/global/*}}` — all global standards (conditionally)

### Phase 4 — `4-create-tech-stack.md`

Inlines:
- `{{workflows/planning/create-product-tech-stack}}` — tech stack workflow
- `{{standards/global/*}}` — all global standards (conditionally)

Each phase has a `{{UNLESS standards_as_claude_code_skills}}` block controlling standards injection and a `{{UNLESS compiled_single_command}}` block for display messages.

---

## Workflow Details

### `gather-product-info.md`

**Purpose:** Collects comprehensive product information from the user.

**Required Information:**
- **Product Idea** — core concept and purpose
- **Key Features** — minimum 3 with descriptions
- **Target Users** — at least 1 user segment with use cases
- **Tech stack confirmation**

Includes a bash script to check if `haikai/product/` folder already exists.

---

### `create-product-mission.md`

**Purpose:** Creates `haikai/product/mission.md`

**Document Structure:**
- **Pitch** — product name, type, target users, value proposition
- **Users** — primary customers, user personas with roles/context/pain points/goals
- **The Problem** — problem description, quantifiable impact, solution
- **Differentiators** — competitive advantages, measurable benefits
- **Key Features** — Core, Collaboration, Advanced categories

**Constraints:**
- Focus on user benefits, not technical details
- Keep it concise and scannable

---

### `create-product-roadmap.md`

**Purpose:** Generates `haikai/product/roadmap.md` with an ordered feature checklist.

**Process:**
1. Review `mission.md` to understand goals
2. Identify concrete features needed
3. Strategic ordering based on:
   - Technical dependencies (foundational features first)
   - Most direct path to mission achievement
   - Incremental building (MVP to full product)
4. Create roadmap using numbered checkbox format

**Roadmap Item Format:**
```markdown
1. [ ] [FEATURE_NAME] — [1-2 SENTENCE DESCRIPTION] `[EFFORT]`
```

**Effort Scale:**
| Label | Duration |
|-------|----------|
| XS | 1 day |
| S | 2-3 days |
| M | 1 week |
| L | 2 weeks |
| XL | 3+ weeks |

**Important:** Does NOT include tasks for initializing the codebase (assumes a bare-bones app exists). Each item represents an end-to-end (frontend + backend) functional feature.

---

### `create-product-tech-stack.md`

**Purpose:** Creates `haikai/product/tech-stack.md`

**Three-Step Process:**
1. **Note User Input** — user-provided tech stack info takes precedence
2. **Gather Default Tech Stack** — read from:
   - User Standards & Preferences (if provided)
   - `claude.md` (in current project)
   - `agents.md` (in current project)
3. **Create Document** — reconcile all sources into a final tech stack list

---

## Standards Injection

Each phase conditionally inlines the **global standards only** (not backend, frontend, or testing):

| File | Content |
|------|---------|
| `coding-style.md` | Naming conventions, DRY, small focused functions, remove dead code |
| `commenting.md` | Self-documenting code, minimal helpful comments |
| `conventions.md` | Project structure, documentation, version control |
| `error-handling.md` | User-friendly messages, fail fast, specific exceptions |
| `tech-stack.md` | Template for defining framework, database, testing, deployment stack |
| `validation.md` | Server-side validation, client-side for UX, sanitize input |

Controlled by `{{UNLESS standards_as_claude_code_skills}}` — when that flag is `true`, standards are NOT inlined.

---

## Output Files

The plan-product skill produces 3 files in `haikai/product/`:

1. **`mission.md`** — Product mission, users, problem, differentiators, features
2. **`roadmap.md`** — Ordered feature checklist with effort estimates
3. **`tech-stack.md`** — Technology stack choices

---

## Multi-Agent Version

A multi-agent variant exists at:

```
haikai-profiles/default/commands/plan-product/multi-agent/plan-product.md
```

Uses a **"product-planner"** subagent and creates files in the `haikai/product/` directory.

---

## Key Takeaway

The plan-product skill is the most phase-heavy skill (4 phases). It compiles a comprehensive prompt that walks Claude through gathering product info, then sequentially creating mission, roadmap, and tech stack documents. Each phase re-inlines the global standards (when enabled), resulting in a large compiled prompt.
