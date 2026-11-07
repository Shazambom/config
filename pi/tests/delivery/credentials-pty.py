# A real PTY is needed to exercise credential-prompts.sh's -t checks and reads.
import errno
import os
import pathlib
import pty
import select
import signal
import sys
import time

work = pathlib.Path(sys.argv[1])
env = dict(os.environ)
env.pop('CONFIG_PI_NO_PROMPT', None)
env['HOME'] = str(work / 'pty-home')
env['CONFIG_PI_HOME'] = str(work / 'pty-state')
pathlib.Path(env['HOME']).mkdir(exist_ok=True)
pid, fd = pty.fork()
if pid == 0:
    os.execvpe('bash', ['bash', str(work / 'repo/init.sh'), '--pi-delivery',
                      str(work / 'pty-receipt.json')], env)
output = b''
prompts = [b'GOOGLE_SEARCH_API_KEY:', b'GOOGLE_CSE_ID:', b'GRAFANA_URL:',
           b'GRAFANA_SERVICE_ACCOUNT_TOKEN:']
answers = [b'synthetic-delivery-key\n', b'synthetic-delivery-engine\n', b'\n', b'\n']
answered = 0
deadline = time.monotonic() + 30
finished = False
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            raise AssertionError('credential PTY deadline exceeded')
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            break
        if not chunk:
            break
        output += chunk
        if answered < len(prompts) and prompts[answered] in output:
            os.write(fd, answers[answered])
            answered += 1
    _, status = os.waitpid(pid, 0)
    finished = True
    assert os.waitstatus_to_exitcode(status) == 0, output.decode(errors='replace')
    assert answered == len(prompts), f'Expected four credential prompts, observed {answered}'
finally:
    (work / 'credentials-pty.log').write_bytes(output)
    if not finished:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(fd)
print('PASS: actual private init/setup PTY prompts and consumes synthetic credential input')
