# wxWidgets framework guidance

A `wxwidgets` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see — not to restate
what it already captured.

wxWidgets is a cross-platform desktop UI toolkit (Windows, Linux,
macOS) built on a deep class hierarchy rooted at `wxObject`. Every
window, control, sizer, dialog, frame, and event handler lives in
this hierarchy. The deterministic adapter detects the inheritance
shape (which classes extend `wxFrame` / `wxDialog` / `wxPanel` /
etc.), which captures the structural skeleton of a wxWidgets app
but misses everything macro-driven, every event-table binding,
every XRC-defined screen, and every sizer layout.

## What the adapter already catches (do NOT re-emit these)

- **Classes inheriting from `wxFrame` / `wxDialog` / `wxWindow` /
  `wxTopLevelWindow`** — emitted as `ui_screens` candidates with
  `className` and `wxBase`. These are the top-level window types
  in a wxWidgets app — every visible chrome-bearing window is a
  `wxFrame` (main window) or `wxDialog` (modal dialog).
- **Classes inheriting from `wxPanel` / `wxButton` / `wxControl` /
  `wxChoice` / `wxComboBox` / `wxListCtrl` / `wxTreeCtrl` /
  `wxTextCtrl` / `wxStaticText` / `wxCheckBox` / `wxRadioButton` /
  `wxSpinCtrl` / `wxNotebook` / `wxSizer` / `wxBoxSizer` /
  `wxGridSizer` / `wxFlexGridSizer`** — emitted as `ui_components`
  candidates with `className`, `wxBase`, and `component_type:
  'other'`. These are the leaf widgets and layout primitives.

The adapter only inspects the SINGLE direct base class — multiple
inheritance and virtual inheritance are NOT walked. A class
inheriting from `wxFrame, wxClientData` will be matched on
`wxFrame` (the IR captures only the first / "main" extends). A
class inheriting from `MyCustomBase` (which itself extends
`wxFrame`) will be MISSED because the adapter does not climb the
hierarchy.

## What the adapter MISSES (your target surface area)

This is where wxWidgets idioms diverge sharply from what
inheritance-based detection captures:

- **Event-table macros (`BEGIN_EVENT_TABLE` / `END_EVENT_TABLE` /
  `EVT_BUTTON` / `EVT_MENU` / `EVT_CHECKBOX` / `EVT_TEXT` /
  `EVT_KEY_DOWN` / `EVT_PAINT` / `EVT_SIZE` / etc.)**. The
  canonical wxWidgets event-binding pattern reads:
  ```cpp
  BEGIN_EVENT_TABLE(MyFrame, wxFrame)
    EVT_BUTTON(ID_OK, MyFrame::OnOK)
    EVT_MENU(ID_QUIT, MyFrame::OnQuit)
    EVT_CLOSE(MyFrame::OnClose)
  END_EVENT_TABLE()
  ```
  Every `EVT_*` line wires a UI event (button click, menu
  selection, window close, etc.) to a handler method on the class.
  Tree-sitter-cpp sees the entire block as opaque macro tokens —
  the bindings are invisible. **Surface each `EVT_*` line as a
  binding candidate** linking the class + event-id-or-event-name
  + handler-method-name. These are how you understand "what
  happens when the user clicks OK" — the equivalent of Spring's
  `@RequestMapping` for desktop UI.
- **XRC `.xrc` XML resource files.** wxWidgets supports a
  declarative UI format where windows, dialogs, and entire
  screen hierarchies are defined in XML and loaded at runtime
  via `wxXmlResource`. A typical .xrc:
  ```xml
  <object class="wxDialog" name="LoginDlg">
    <object class="wxBoxSizer" orient="wxVERTICAL">
      <object class="wxStaticText" name="prompt">
        <label>Enter password:</label>
      </object>
      <object class="wxTextCtrl" name="password"/>
      <object class="wxButton" name="ok"><label>OK</label></object>
    </object>
  </object>
  ```
  This file declares an entire dialog with no .cpp counterpart
  beyond a one-liner `wxXmlResource::Get()->LoadDialog(parent,
  "LoginDlg")`. The pack does NOT parse .xrc files at all
  (extension filter rejects them) — the entire UI screen
  hierarchy is invisible. **Surface XRC-declared screens as
  `ui_screens` / `ui_components` candidates with the XML
  `name` attribute as the candidate name.**
- **Sizer layout intent.** Every wxWidgets window uses sizers
  (`wxBoxSizer`, `wxGridSizer`, `wxFlexGridSizer`,
  `wxGridBagSizer`) to lay out children. The parent-child
  relationship between a sizer and the controls it contains is
  expressed via runtime `Add()` calls:
  ```cpp
  auto sizer = new wxBoxSizer(wxVERTICAL);
  sizer->Add(new wxButton(this, ID_OK, "OK"), 1, wxEXPAND | wxALL, 5);
  sizer->Add(myTextCtrl, 0, wxALIGN_CENTER);
  this->SetSizer(sizer);
  ```
  The adapter sees `wxBoxSizer` extending nothing relevant and
  may emit a `ui_components` for it (if a custom subclass exists),
  but the actual `Add()` call graph that links controls into
  layout containers is invisible. **Surface the sizer hierarchy
  as a structural diagram of the screen** — this is how a
  reviewer understands the visual layout without running the app.
- **Custom event class declarations via `DECLARE_EVENT_TYPE` /
  `DEFINE_EVENT_TYPE` / `wxDEFINE_EVENT` / `wxDECLARE_EVENT`.**
  Apps often declare custom event types for cross-component
  notifications:
  ```cpp
  wxDECLARE_EVENT(EVT_USER_LOGGED_IN, wxCommandEvent);
  wxDEFINE_EVENT(EVT_USER_LOGGED_IN, wxCommandEvent);
  ```
  These are application-level event channels — the equivalent of
  domain events. The adapter does NOT detect them. **Surface each
  custom event type as a `domain_event` candidate** with the
  declaring class.
- **`wxConfig` persistence.** wxWidgets apps persist user
  preferences via `wxConfig::Get()->Read("/UI/MainWindow/Width",
  ...)` and `Write(...)`. The set of config keys read/written
  forms an implicit configuration surface. The adapter does NOT
  detect these — they are call expressions deep inside method
  bodies. **Surface `wxConfig` keys as configuration entries**
  so the persisted state is documented.
- **i18n via `_()` / `wxGetTranslation()` macros.** Every user-
  facing string in a properly-internationalised wxWidgets app is
  wrapped in `_("Hello, world!")` (the `_` macro is shorthand for
  `wxGetTranslation`). These strings are extracted into `.po`
  files at build time via `xgettext`. The adapter does NOT
  surface them. **Surface user-facing string inventories** so
  the visible UI text is auditable — this matters for compliance
  / accessibility / localisation reviews.
- **AUI (Advanced User Interface) docking layout.** Apps using
  the `wxAuiManager` / `wxAuiNotebook` family declare dockable
  panes via `wxAuiManager::AddPane(window, wxAuiPaneInfo()...)`.
  The pane configuration (caption, position, dock, floatable,
  resizable) is intent the adapter cannot see. **Surface AUI
  pane declarations** as `ui_components` candidates with their
  pane configuration.
- **MDI (Multiple Document Interface) frames.** Apps with MDI
  declare a `wxMDIParentFrame` containing multiple
  `wxMDIChildFrame` instances. The adapter detects the
  inheritance but not the parent/child relationship between
  frames. Surface the MDI tree explicitly.
- **Document/View framework.** Apps using `wxDocManager` /
  `wxDocTemplate` register file-format templates that bind
  `wxDocument` subclasses to `wxView` subclasses. This is the
  app's persistence + display model. Surface these as
  application-level document types.
- **Drag-and-drop targets.** Classes inheriting from
  `wxDropTarget` / `wxFileDropTarget` / `wxTextDropTarget` are
  drag-drop receivers; the adapter may or may not match them
  depending on the base name. Surface them explicitly.
- **wxIPC** — interprocess communication via `wxServer` /
  `wxClient` is invisible to the adapter; surface as
  integration boundary.

## Idioms to recognise as cues

- **`wx`-prefix is the framework namespace convention.** Every
  framework-provided type starts with `wx`. App-specific types
  conventionally start with `My`, `App`, or the app's name
  prefix. A file with multiple `wx`-prefixed bases plus an
  `App` / `MyApp` class extending `wxApp` is almost certainly an
  application's main file.
- **`wxApp` subclass.** Every wxWidgets app has exactly one
  class extending `wxApp` with an `OnInit()` method that
  constructs the main frame. Use this to identify the app
  entry point.
- **`DECLARE_APP` + `IMPLEMENT_APP` macros** wire the app class
  to the platform-specific `main()` / `WinMain()`. Invisible to
  IR.
- **Resource files (.rc on Windows)** declare icons, dialogs in
  the platform-native format, distinct from XRC. Outside the
  pack's file filter.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
