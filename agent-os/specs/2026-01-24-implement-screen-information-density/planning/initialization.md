# Spec Initialization: Implement Screen Information Density

## Raw Idea

This spec covers Screen Change 4 with three main parts:

A) Remove "Implementation Assistant" header bar
B) Move chat composer into RHS Team Chat panel only
C) Density changes (reduce padding, margins, font sizes)

## Key Requirements from User's YAML

- Remove full-width "Implementation Assistant" header bar entirely
- Move composer to only render inside RHS Team Chat panel (anchored at bottom)
- LHS Feature Definition column gains reclaimed vertical space
- Reduce vertical padding/margins in Feature Definition cards by 25-40%
- Reduce gaps between cards by 30-40%
- Reduce section header font size by one step
- Reduce body text font size slightly
- Reduce Open Questions table row height and padding
- Team Chat becomes vertical flex layout (scrolling messages + fixed composer)

## Scope Exclusions

- No behavioral changes
- No endpoint/state model changes
- No structural changes beyond presentation/layout
