#!/usr/bin/env python3
"""Keep one actual tmux client on a private PTY; never open a host terminal."""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

class TerminalQueries:
    """Only fixed colour queries. This is not a screen or clipboard emulator.

    OSC framing survives arbitrary PTY read boundaries. Other control strings
    are consumed without interpreting their payload, including nested escapes.
    """
    ANSI = ('000000', 'cd0000', '00cd00', 'cdcd00', '0000ee', 'cd00cd',
            '00cdcd', 'e5e5e5', '7f7f7f', 'ff0000', '00ff00', 'ffff00',
            '5c5cff', 'ff00ff', '00ffff', 'ffffff')
    LIMIT = 4096

    def __init__(self):
        self.state = 'ground'
        self.payload = bytearray()
        self.discard = False

    @classmethod
    def colour(cls, index):
        if index < 16:
            rgb = tuple(bytes.fromhex(cls.ANSI[index]))
        elif index < 232:
            cube = (0, 95, 135, 175, 215, 255)
            n = index - 16
            rgb = (cube[n // 36], cube[(n // 6) % 6], cube[n % 6])
        else:
            rgb = (8 + (index - 232) * 10,) * 3
        return ('rgb:' + '/'.join(f'{value:02x}{value:02x}' for value in rgb)).encode('ascii')

    def append(self, byte):
        if len(self.payload) < self.LIMIT:
            self.payload.append(byte)
        else:
            self.discard = True

    def finish(self, end):
        self.state = 'ground'
        if self.discard:
            return []
        payload = bytes(self.payload)
        if not payload.isascii():
            return []
        parts = payload.split(b';')
        replies = []
        if parts in ([b'10', b'?'], [b'11', b'?']):
            index = 7 if parts[0] == b'10' else 0
            replies.append(b'\x1b]' + parts[0] + b';' + self.colour(index) + end)
        elif parts[0] == b'4' and len(parts) >= 3 and len(parts) % 2 == 1:
            for number, value in zip(parts[1::2], parts[2::2]):
                if value != b'?' or not number.isdigit() or len(number) > 3:
                    continue
                index = int(number)
                if index < 256:
                    replies.append(b'\x1b]4;' + number + b';' + self.colour(index) + end)
        query = b'\x1b]' + payload + end
        return [(query, reply) for reply in replies]

    def feed(self, data):
        replies = []
        for byte in data:
            if self.state == 'ground':
                if byte == 27:
                    self.state = 'escape'
            elif self.state == 'escape':
                if byte == ord(']'):
                    self.state = 'osc'
                    self.payload.clear()
                    self.discard = False
                elif byte in (ord('P'), ord('X'), ord('^'), ord('_')):
                    self.state = 'string'
                elif byte != 27:
                    self.state = 'ground'
            elif self.state == 'string':
                if byte == 27:
                    self.state = 'string-escape'
            elif self.state == 'string-escape':
                if byte == ord('\\'):
                    self.state = 'ground'
                elif byte != 27:
                    self.state = 'string'
            elif self.state == 'osc':
                if byte == 7:
                    replies.extend(self.finish(b'\x07'))
                elif byte == 27:
                    self.state = 'osc-escape'
                else:
                    self.append(byte)
            elif self.state == 'osc-escape':
                if byte == ord('\\'):
                    replies.extend(self.finish(b'\x1b\\'))
                else:
                    # No recursive interpretation inside an OSC payload.
                    self.append(27)
                    self.append(byte)
                    self.state = 'osc'
        return replies


def main():
    root, name, tmux = sys.argv[1:]
    base = Path(root) / 'clients' / name
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))

    def terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    child = subprocess.Popen([tmux, '-S', root + '/tmux.sock', 'attach-session', '-t', 'lab'],
                             stdin=slave, stdout=slave, stderr=slave, preexec_fn=terminal)
    os.close(slave)
    (base / 'ready.json').write_text(json.dumps({'pid': child.pid}))
    stop = False

    def stopping(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, stopping)
    signal.signal(signal.SIGINT, stopping)
    last = ''
    queries = TerminalQueries()
    with (base / 'terminal.ansi').open('ab', buffering=0) as log, \
            (base / 'terminal-input.ansi').open('ab', buffering=0) as inputs, \
            (base / 'terminal-responses.jsonl').open('a', buffering=1) as responses:
        while child.poll() is None and not stop:
            control = base / 'resize.json'
            if control.exists():
                raw = control.read_text()
                if raw != last:
                    size = json.loads(raw)
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', size['rows'], size['cols'], 0, 0))
                    last = raw
            if (base / 'close').exists():
                break
            if select.select([master], [], [], .1)[0]:
                try:
                    data = os.read(master, 65536)
                    log.write(data)
                    for query, response in queries.feed(data):
                        written = 0
                        error = None
                        try:
                            while written < len(response):
                                count = os.write(master, response[written:])
                                inputs.write(response[written:written + count])
                                written += count
                        except OSError as exc:
                            error = exc.errno
                            raise
                        finally:
                            responses.write(json.dumps({
                                'time': time.time(), 'actor': os.getpid(), 'client': child.pid,
                                'event': 'terminal-response', 'query': query.decode('ascii'),
                                'response': response.decode('ascii'), 'bytesWritten': written,
                                'error': error,
                            }) + '\n')
                except OSError:
                    break
    os.close(master)
    # Closing our own PTY is the requested close action, not a product-process kill.
    try:
        code = child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        # Popen owns this unreaped direct child, so its PID cannot be reused here.
        child.terminate()
        try:
            code = child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            code = child.wait(timeout=2)
    (base / 'exit.json').write_text(json.dumps({'pid': child.pid, 'code': code, 'time': time.time()}))


if __name__ == '__main__':
    main()
