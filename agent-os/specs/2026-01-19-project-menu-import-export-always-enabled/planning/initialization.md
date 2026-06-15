# Spec Initialization

## Spec Name
Project Menu Import/Export Always Enabled

## Initial Description
The Import/Export menu items in the Project menu (FileMenu component) should always be enabled, regardless of whether a project is currently loaded or any other state.

Currently:
- `importJsonDisabled` and `importXlsxDisabled` are set to `!state.loadedFileName` (disabled when no project loaded)
- `exportJsonDisabled` and `exportXlsxDisabled` are already set to `false` (always enabled)

The fix should:
- Change `importJsonDisabled` and `importXlsxDisabled` to always be `false`
- Keep `exportJsonDisabled` and `exportXlsxDisabled` as `false`
- Remove the guards in click handlers that prevent action when disabled
- Update or remove tests that expect these items to be disabled

This is a simple change - the user wants all 4 file-based Import/Export actions to always be available, independent of project state or feature toggles.
