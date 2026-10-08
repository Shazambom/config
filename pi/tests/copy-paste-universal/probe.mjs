// Observation and fixture setup only. No clipboard, copy, or paste implementation.
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = text => createHash('sha256').update(text).digest('hex');
export default async function (pi) {
  const { Input, matchesKey } = await import(process.env.PI_UNIVERSAL_TUI);
  const root = process.env.PI_UNIVERSAL_CASE;
  let timer, last, submissions = 0, overlaySubmissions = 0, tui, closeOverlay, input;
  let instruction = 'BOOTSTRAP: do not type or copy yet';
  let copyKeys = 0, pasteKeys = 0;
  const record = details => appendFileSync(`${root}/events.jsonl`, JSON.stringify(details) + '\n');
  pi.on('input', () => { submissions++; return { action: 'handled' }; });
  pi.on('before_agent_start', () => { throw new Error('Acceptance fixture forbids model calls'); });
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setWidget('universal-observer', value => {
      tui = value;
      return { render: () => [instruction], invalidate() {} };
    });
    ctx.ui.onTerminalInput(data => {
      if (matchesKey(data, 'super+c')) copyKeys++;
      if (matchesKey(data, 'super+v')) pasteKeys++;
    });
    const history = ctx.sessionManager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'universal-history');
    record({ event: 'ready', session: ctx.sessionManager.getSessionId(), file: ctx.sessionManager.getSessionFile(), history: history.length });
    pi.appendEntry('universal-history', { synthetic: true });
    // A visible message causes Pi to flush the new session before a resume check.
    pi.sendMessage({ customType: 'universal-fixture', content: 'PI_SYNTHETIC_BOOTSTRAP', display: true });
    timer = setInterval(() => {
      let command;
      try { command = JSON.parse(readFileSync(`${root}/request.json`, 'utf8')); } catch { return; }
      if (command.id === last) return;
      last = command.id;
      if (command.action === 'prepare') {
        if (closeOverlay) { closeOverlay(); closeOverlay = undefined; }
        input = undefined;
        if (command.surface === 'transcript') {
          pi.sendMessage({ customType: 'universal-fixture', content: command.text, display: true });
          ctx.ui.setEditorText('');
        } else if (command.surface === 'editor') ctx.ui.setEditorText(command.text);
        else if (command.surface === 'overlay') {
          ctx.ui.setEditorText('');
          input = new Input();
          input.onSubmit = () => { overlaySubmissions++; };
          void ctx.ui.custom((_tui, _theme, _keys, done) => {
            closeOverlay = done;
            return {
              get focused() { return input.focused; },
              set focused(value) { input.focused = value; },
              render(width) { return [instruction, ...command.text.split('\n'), ...input.render(width)]; },
              invalidate() { input.invalidate(); },
              handleInput(data) { input.handleInput(data); },
            };
          }, { overlay: true });
        }
        tui?.requestRender();
        record({ event: 'prepared', id: last });
      } else if (command.action === 'instruction') {
        instruction = command.text;
        tui?.requestRender();
        record({ event: 'instruction', id: last });
      } else if (command.action === 'clear') {
        // Keep the actual Input overlay focused when it is the paste destination.
        ctx.ui.setEditorText('');
        input?.setValue('');
        tui?.requestRender();
        record({ event: 'cleared', id: last });
      } else if (command.action === 'state') {
        const draft = ctx.ui.getEditorText();
        const focused = input ? input.getValue() : draft;
        record({ event: 'state', id: last, sha256: digest(draft), bytes: Buffer.byteLength(draft),
          focusedSha256: digest(focused), focusedBytes: Buffer.byteLength(focused),
          selected: tui?.hasActiveSelection?.() ?? null, overlay: tui?.hasOverlay?.() ?? null,
          submissions, overlaySubmissions, copyKeys, pasteKeys });
      } else if (command.action === 'stop') ctx.shutdown();
    }, 100);
  });
  pi.on('session_shutdown', () => clearInterval(timer));
}
