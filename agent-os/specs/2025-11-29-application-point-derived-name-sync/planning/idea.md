# Raw Idea

Strengthen Application Point name synchronisation so that `application_point.name` is treated as a fully derived field from the source entity (Application, App Component, or Service). The name should sync on:

1. JSON load (create missing APs, force name = source entity name)
2. Entity edit (when source entity name changes, immediately update AP name)
3. Before save/validation (final sync pass to ensure alignment)

This fixes the issue where Application Points have missing names and produce validation errors like:

```
APPLICATION_POINT ['unnamed row'] requires a value in field 'name'
```
