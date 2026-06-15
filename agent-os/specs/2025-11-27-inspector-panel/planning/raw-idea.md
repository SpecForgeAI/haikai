# Inspector Panel Feature

We want to add a new collapsible **left-hand "Inspector" panel** in the Diagrams view that lets users edit visual text styling for selected diagram nodes and edges. Currently these values can only be changed by editing JSON; this feature makes them editable via the UI.

## Key Requirements:

1) **Left-hand Inspector panel: layout & visibility**
   - Panel appears only in the Diagrams view (not in Meta-model view)
   - Collapsible/expandable, similar to existing right-hand palette panel
   - Layout: Left (Inspector) | Center (Canvas) | Right (Palette)
   - When collapsed: slim vertical bar with expand chevron
   - When expanded: fixed narrow width with vertical scroll
   - Content sections: Font Size, Font Styles, Text Alignment

2) **Selection model: nodes and edges (single and multi-select)**
   - Clicking node/edge selects it and updates Inspector
   - Ctrl+click for multi-select (add/remove from selection)
   - Inspector controls apply to all selected items
   - Mixed values show unset/mixed state

3) **Data model extensions for text styling**
   - diagram_nodes: text_font_size, text_font_weight, text_font_style, text_text_decoration, text_h_align, text_v_align
   - diagram_edges: label_font_size, label_font_weight, label_font_style, label_text_decoration, label_h_align, label_v_align

4) **Inspector controls**
   - Font Size: Increase/Decrease icons + numeric input (1-99)
   - Font Styles: Italic, Underline, Bold toggle icons
   - Text Alignment: Vertical (Top/Middle/Bottom) and Horizontal (Left/Center/Right) icons
   - All icons have tooltips

5) **Data flow and persistence**
   - Changes update in-memory model and re-render immediately
   - Save/Load JSON preserves styling fields

## Acceptance Criteria:
- Collapsible left-hand Inspector panel in Diagrams view
- Node/edge selection updates panel; multi-select via Ctrl+click
- Font Size/Styles/Alignment changes apply immediately and persist through Save/Load
- Icons are intuitive with informative tooltips
