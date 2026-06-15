/*
 * Flip Task Group 5 checkboxes to done in tasks.md.
 */
const fs = require('fs');
const TASKS = 'C:/Workspaces/SSD/architecture-store-and-diagrams/agent-os/specs/2026-05-20-in-product-spec-editor-confirm-overwrite/tasks.md';

const edits = [
  ['- [ ] 5.0 Gateway proxies for the new endpoints and flag pass-through',
   '- [x] 5.0 Gateway proxies for the new endpoints and flag pass-through'],
  ['  - [ ] 5.1 Write 2-8 focused tests in `gateway/src/__tests__/`',
   '  - [x] 5.1 Write 2-8 focused tests in `gateway/src/__tests__/`'],
  ['  - [ ] 5.2 Add `POST /api/projects/:projectId/spec-generations/:specId/manual-edit`',
   '  - [x] 5.2 Add `POST /api/projects/:projectId/spec-generations/:specId/manual-edit`'],
  ['  - [ ] 5.3 Add `GET /api/projects/:projectId/migration-books-of-work/:bookId/spec-generations/manually-edited-in-scope`',
   '  - [x] 5.3 Add `GET /api/projects/:projectId/migration-books-of-work/:bookId/spec-generations/manually-edited-in-scope`'],
  ['  - [ ] 5.4 Extend existing batch route + retry-batch route',
   '  - [x] 5.4 Extend existing batch route + retry-batch route'],
  ['  - [ ] 5.5 Ensure gateway-layer tests pass',
   '  - [x] 5.5 Ensure gateway-layer tests pass'],
];

let src = fs.readFileSync(TASKS, 'utf-8');
for (const [find, replace] of edits) {
  if (src.indexOf(find) === -1) {
    console.error('Not found:', find);
    process.exit(2);
  }
  src = src.replace(find, replace);
}
fs.writeFileSync(TASKS, src);
console.log('Tasks updated');
