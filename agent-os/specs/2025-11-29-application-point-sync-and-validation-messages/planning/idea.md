# Raw Idea

Two fixes to improve behaviour and usability:

1. Auto-created Application Points must copy the source entity's name - when creating Applications, App Components, or Services, the corresponding Application Point should have its name populated from the source entity. Also sync names on JSON load.

2. Improve validation error messages to include entity type, row name, and field name - replace generic "This field is required" with specific messages like "APPLICATION_POINT ['OMS System'] requires a value in field 'name'"
