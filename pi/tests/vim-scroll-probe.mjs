import { appendFileSync } from 'node:fs';
export default function (pi) {
  const record = value => appendFileSync(`${process.env.PI_SCROLL_PROOF}/events.jsonl`, JSON.stringify(value) + '\n');
  let timer;
  pi.on('session_start', (_event, ctx) => {
    let ui;
    ctx.ui.setWidget('scroll-proof', tui => { ui = tui; return { render: () => [], invalidate() {} }; });
    ctx.ui.onTerminalInput(data => {
      if (data === '\x1b[17~') {
        const editor = ui.getFocusedComponent();
        record({ event: 'state', following: ui.isFollowingOutput, mode: editor?.getVimMode?.(), pending: editor?.isVimInputPending?.(), text: ctx.ui.getEditorText() });
        return { consume: true };
      }
      if (data === '\x1b[18~') {
        void ctx.ui.custom((_tui, _theme, _keys, done) => ({
          render: () => ['SCROLL_TEST_OVERLAY'], invalidate() {},
          handleInput(key) { if (key === 'G') record({ event: 'overlay-G' }); if (key === '\x1b') done(); },
        }), { overlay: true });
        return { consume: true };
      }
    });
    timer = setTimeout(() => {
      pi.sendMessage({ customType: 'scroll-proof', content: Array.from({ length: 100 }, (_, n) => `SCROLL_ROW_${n}`).join('\n'), display: true });
      ctx.ui.setEditorText('DRAFT');
      record({ event: 'ready' });
    }, 300);
  });
  pi.on('session_shutdown', () => clearTimeout(timer));
}
