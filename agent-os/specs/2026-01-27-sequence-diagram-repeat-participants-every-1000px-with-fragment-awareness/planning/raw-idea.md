# Raw Idea

**Name:** sequence-diagram-repeat-participants-every-1000px-with-fragment-awareness

**Scope:** frontend

**Type:** layout-enhancement

## Description

```
intent:
  Improve readability of very tall Sequence Diagrams by re-drawing participants vertically
  at regular intervals, without breaking fragment boundaries.

trigger_rule:
  - Track the Y-position where participants were last drawn.
  - Before drawing ANY new message exchange or fragment, evaluate:
      distance = currentY - lastParticipantsDrawY
  - Threshold: distance >= 1000px

required_logic:
  evaluation_point:
    - This check MUST run before rendering each next message exchange or fragment.

  case_1_not_inside_fragment:
    condition:
      - distance >= 1000px
      - AND the next item to draw is NOT inside an open fragment
    behavior:
      - Redraw participants immediately.
      - Update lastParticipantsDrawY.
      - Continue rendering the next message exchange or fragment.

  case_2_inside_fragment:
    condition:
      - distance >= 1000px
      - AND the current rendering position is inside an open fragment
    behavior:
      - DO NOT redraw participants yet.
      - Continue rendering until the fragment is fully closed.
      - Immediately after the fragment ends:
          - Redraw participants.
          - Update lastParticipantsDrawY.
      - Continue rendering subsequent items.

  case_3_below_threshold:
    condition:
      - distance < 1000px
    behavior:
      - Do nothing.
      - Continue rendering normally.

constraints:
  - Participants must NEVER be drawn mid-fragment.
  - Fragment layout, sizing, and semantics must remain unchanged.
  - Participant redraws are static (not sticky/floating).
  - No changes to message ordering, spacing rules, or lifeline alignment.
  - Applies to all message types (normal, self-loop, etc.).

implications:
  - Participants may be rendered multiple times within a single diagram.
  - Example: a 2500px-tall diagram results in participants being drawn 3 times.
  - Redraw frequency is governed solely by vertical distance and fragment boundaries.

acceptance_criteria:
  - Participants reappear approximately every 1000px of vertical scroll.
  - No fragment is visually split by a participant redraw.
  - Long diagrams remain readable without layout regressions.
```
