import { appendFileSync, writeFileSync } from 'node:fs';

export default function (pi) {
  const root = process.env.PI_SELECTION_PROOF;
  const record = (event, details = {}) => appendFileSync(`${root}/events.jsonl`, JSON.stringify({ event, ...details }) + '\n');
  let timer;
  pi.on('session_start', (_event, ctx) => {
    let ui;
    ctx.ui.setWidget('clipboard-test', tui => {
      ui = tui;
      // Only replace the OS clipboard backend. Real mouse selection and native copy run unchanged.
      tui.copySelection = async text => {
        writeFileSync(`${root}/clipboard.txt`, text);
        record('copy', { text });
        return true;
      };
      return { render: () => [], invalidate() {} };
    }, { placement: 'belowEditor' });
    ctx.ui.onTerminalInput(data => {
      if (data === '\x1b[17~') {
        record('state', { selected: ui.hasActiveSelection(), draft: ctx.ui.getEditorText() });
        return { consume: true };
      }
      if (data === '\x1b[18~') {
        void ctx.ui.custom((_tui, _theme, _keys, done) => ({
          render: () => ['CLIPBOARD_TEST_OVERLAY'], invalidate() {},
          handleInput(data) { if (data === '\x03') { record('overlay-cancel'); done(); } },
        }), { overlay: true });
        return { consume: true };
      }
    });
    timer = setTimeout(() => {
      pi.sendMessage({ customType: 'clipboard-test', content: 'SELECTION_TARGET other text', display: true });
      ctx.ui.setEditorText('KEEP_DRAFT');
      record('ready');
    }, 300);
  });
  pi.on('session_shutdown', () => clearTimeout(timer));
}
