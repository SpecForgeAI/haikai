# Raw Idea

## Title
Single Source of Truth Bootstrap Endpoint + Wire Feature Toggles into Live UI

## Intent
Make the architecture-model-service the single source of truth for startup feature toggles and any future UI bootstrap data. The frontend must call a generic bootstrap endpoint on startup to obtain includeDelivery/includeDatabase, then actually apply those toggles in the live UI (tabs, menus, routes) so the UI changes occur when the endpoint returns false/false.
