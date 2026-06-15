```
intent:
  1) Allow "Decorations" to be added to diagrams of type="Sequence" (in addition to the existing
     rule-driven sequence rendering of Participants, Message Exchanges, and Fragments).
  2) Introduce a new Decoration type "Note" styled like a post-it note (folded corner + text).

principles:
  - Sequence diagrams remain deterministically rendered from Participants/MessageExchanges/Fragments.
  - Decorations are an optional overlay layer (do not affect sequence layout rules).
  - Decorations behave the same across diagram types (drag, resize, edit text where applicable).
  - Decorations persist with the diagram and reload accurately.

data_model_requirements:
  decorations_on_sequence_diagrams:
    - Sequence diagram typed content MUST support a decorations collection, identical in structure
      to the existing "General" diagram decorations model.
    - If a shared diagram-level decorations collection already exists (used by General),
      reuse it for Sequence (no duplicate schema).
    - Backward compatibility: If decorations missing, treat as empty list.

  new_decoration_type_note:
    - Add DecorationType: "Note"
    - Fields: id, type="Note", x, y, width, height, rotation (optional), text (default ""),
      textAlign (default "center"), verticalAlign (default "middle"), style

default_visual_style_note:
  - fill: classic post-it yellow
  - stroke: black
  - strokeWidth: 3px
  - foldedCorner: top-left corner fold
  - text: centered inside note body, editable

frontend_requirements:
  decorations_panel_availability:
    - Enable the existing "Decorations" panel for diagram type="Sequence"
    - Users can add any existing decoration onto a Sequence diagram
  palette_updates:
    - Add "Note" to Decorations palette
  interaction_behavior:
    - Same interactions as General: select, drag, resize, edit text
    - Must not interfere with participant/message/fragment selection

sequence_renderer_changes:
  render_layers:
    - Render deterministic elements as today
    - Render Decorations as additional layer
    - Use same layering approach as General diagrams
  note_rendering:
    - SVG rectangle with folded top-left corner, strokeWidth 3, post-it yellow fill, centered text

model_service_requirements:
  persistence:
    - Save/load pipeline includes decorations for Sequence diagrams (same as General)
    - No new DB schema if decorations already persist via existing diagram content storage
    - Backward compatibility: existing Sequence diagrams load with empty decorations list

non_goals:
  - Do not change sequence layout rules based on decorations
  - Do not introduce new decoration styling UI
  - Do not add "sticky" behavior
  - Do not change export/print behavior

acceptance_criteria:
  - On a Sequence diagram, the Decorations panel is available and users can add existing decorations
  - A new "Note" decoration exists in the palette and can be placed on the canvas
  - Note renders as a post-it (yellow fill, black 3px border, folded top-left corner) with centered text
  - Decorations persist on save and reload for Sequence diagrams
  - Sequence Participants/MessageExchanges/Fragments continue to render and behave exactly as before
```
