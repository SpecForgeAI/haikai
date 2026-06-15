# Raw Idea

## Title
Fix Bootstrap Toggle Mapping (snake_case vs camelCase) So UI Gating Activates

## Intent
Ensure the frontend correctly interprets the feature toggles returned by the backend /api/bootstrap endpoint so that includeDelivery/includeDatabase UI gating actually takes effect. The backend currently serializes JSON keys in snake_case (include_delivery/include_database) due to the global Jackson naming strategy, while the frontend expects camelCase (includeDelivery/includeDatabase) and falls back to defaults.
