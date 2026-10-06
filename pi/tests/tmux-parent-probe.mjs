// Observes the actual interactive parent. Does not replace the subagent tools.
import { appendFileSync } from 'node:fs';
export default function (pi) {
  const root = process.env.PI_TMUX_PROOF;
  const record = (event, data = {}) => appendFileSync(`${root}/events.jsonl`, JSON.stringify({ event, ...data }) + '\n');
  const originalWrite = process.stdout.write;
  let timer;
  pi.on('session_start', (_event, ctx) => {
    process.stdout.write = function (chunk, ...args) {
      appendFileSync(`${root}/parent.ansi`, chunk);
      return originalWrite.call(this, chunk, ...args);
    };
    ctx.ui.onTerminalInput(data => {
      if (data !== '\x1b[17~') return;
      record('draft', { text: ctx.ui.getEditorText() });
      return { consume: true };
    });
    timer = setTimeout(() => {
      pi.sendMessage({ customType: 'proof-history', content: Array.from({ length: 500 }, (_, i) => `HISTORY_${String(i).padStart(3, '0')} old synthetic transcript text`).join('\n'), display: true });
      record('ready', { mode: ctx.mode, hasUI: ctx.hasUI, pid: process.pid, cli: process.argv[1] });
    }, 500);
  });
  pi.on('tool_result', event => record('tool-result', { name: event.toolName, isError: event.isError, content: event.content, details: event.details }));
  pi.on('message_end', event => {
    if (event.message.customType === 'subagent_result') record('notification', { message: event.message });
  });
  pi.on('agent_end', () => record('idle'));
  pi.on('session_shutdown', () => { clearTimeout(timer); process.stdout.write = originalWrite; });
}
