# permission-models

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/permission/models.py
- **Category**: happy path (authz models: Permission + PermissionMixin)

## Why this fixture

Saleor's custom Permission model (distinct from Django's built-in
auth permission) plus a PermissionMixin. 8 candidates emitted
(2 entities, 3 attributes, 3 relationships).

## Notes

- Potential LLM gap-fill target: the module implements custom
  `Permission`-class semantics that downstream DRF permission
  classes / `has_permission` hooks extend. Surface the wider
  permission-check flow as authz architecture.
