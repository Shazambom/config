import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default function (pi: any) {
  const directory = process.env.LIFECYCLE_LAB!;
  pi.on('session_start', () => {
    const bin = join(directory, 'monitor-bin');
    if (!process.env.PATH?.startsWith(`${bin}:`)) process.env.PATH = `${bin}:${process.env.PATH}`;
  });
  pi.on('before_agent_start', () => {
    pi.events.emit('session-lifecycle:admission', { respond: (admission: any) => {
      const state = (globalThis as any)[Symbol.for('portable-pi.session-lifecycle')];
      writeFileSync(join(directory, 'monitor-admission.json'), JSON.stringify({ ...admission, helperPid: state.child?.pid }));
    } });
  });
}
