/**
 * wxWidgets Framework Adapter — STUB.
 *
 * Detects classes that look like wxWidgets UI components:
 *   class MyWindow : public wxFrame { ... }    → ui_screen
 *   class MyDialog : public wxDialog { ... }   → ui_screen
 *   class MyPanel  : public wxPanel { ... }    → ui_component
 *   class MyButton : public wxButton { ... }   → ui_component
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR } from '../../languageIR';

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string, filePath: string, data: Record<string, unknown>, runId: string,
): DiscoveryCandidate {
  return {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.7,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'wxwidgets-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
}

const SCREEN_BASE_RE = /^wx(Frame|Dialog|Window|TopLevelWindow)$/;
const COMPONENT_BASE_RE = /^wx(Panel|Button|Control|Choice|ComboBox|ListCtrl|TreeCtrl|TextCtrl|StaticText|CheckBox|RadioButton|SpinCtrl|Notebook|Sizer|BoxSizer|GridSizer|FlexGridSizer)$/;

export function runWxwidgetsAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  for (const file of files) {
    for (const cls of file.classes) {
      if (!cls.extends) continue;
      if (SCREEN_BASE_RE.test(cls.extends)) {
        out.push(makeCandidate('ui_screens', cls.name, file.filePath, { className: cls.name, wxBase: cls.extends }, runId));
      } else if (COMPONENT_BASE_RE.test(cls.extends)) {
        out.push(makeCandidate('ui_components', cls.name, file.filePath, { className: cls.name, wxBase: cls.extends, component_type: 'other' }, runId));
      }
    }
  }
  return out;
}
