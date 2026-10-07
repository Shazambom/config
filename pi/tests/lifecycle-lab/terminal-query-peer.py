#!/usr/bin/env python3
"""Byte-level test peer for the private PTY helper, never a host terminal."""
import json
import os
from pathlib import Path
import select
import sys
import time
import tty

root = Path(sys.argv[2]).parent  # helper invokes peer -S LAB/tmux.sock attach-session ...
tty.setraw(0)
sent = (root / 'sent.ansi').open('ab', buffering=0)
received = (root / 'received.ansi').open('ab', buffering=0)
cases = 0

def exchange(chunks, expected):
    global cases
    for chunk in chunks:
        os.write(1, chunk)
        sent.write(chunk)
        # Force fragmented PTY reads, without changing any app exit timing.
        time.sleep(.002)
    response = b''
    deadline = time.monotonic() + (1.0 if expected else .025)
    while time.monotonic() < deadline:
        ready = select.select([0], [], [], max(0, deadline - time.monotonic()))[0]
        if not ready:
            break
        data = os.read(0, 4096)
        received.write(data)
        response += data
        if len(response) >= len(expected):
            break
    assert response == expected, {'query': b''.join(chunks).hex(), 'expected': expected.hex(), 'actual': response.hex()}
    cases += 1

try:
    # Expected colours define the lab's fixed xterm-style palette, not host values.
    for end in (b'\x07', b'\x1b\\'):
        for query, expected in (
            (b'\x1b]10;?' + end, b'\x1b]10;rgb:e5e5/e5e5/e5e5' + end),
            (b'\x1b]11;?' + end, b'\x1b]11;rgb:0000/0000/0000' + end),
            (b'\x1b]4;1;?;2;?;16;?;255;?' + end,
             b''.join((b'\x1b]4;1;rgb:cdcd/0000/0000' + end,
                       b'\x1b]4;2;rgb:0000/cdcd/0000' + end,
                       b'\x1b]4;16;rgb:0000/0000/0000' + end,
                       b'\x1b]4;255;rgb:eeee/eeee/eeee' + end))),
        ):
            exchange([query], expected)
            # Every two-chunk boundary, including split ESC/ST and query digits.
            for split in range(1, len(query)):
                exchange([query[:split], query[split:]], expected)
            exchange([bytes([byte]) for byte in query], expected)
    query = b'\x1b]10;?\x07text\x1b]11;?\x1b\\'
    exchange([query], b'\x1b]10;rgb:e5e5/e5e5/e5e5\x07\x1b]11;rgb:0000/0000/0000\x1b\\')
    # Never read/write clipboard, decode its data, execute titles, or unwrap DCS.
    for ignored in (
        b'plain text', b'\x1b[6n', b'\x1b]52;c;?\x07', b'\x1b]52;c;YWJj\x1b\\',
        b'\x1b]2;title\x07', b'\x1b]4;1;red\x07', b'\x1b]10;red\x07',
        b'\x1b]4;256;?\x07', b'\x1b]4;-1;?\x07', b'\x1b]4;1\x07',
        b'\x1b]4;1;?;2;\xff\x07',
        b'\x1bPpayload\x1b]10;?\x07\x1b\\', b'\x1b_payload\x1b]11;?\x07\x1b\\',
        b'\x1b]52;' + b'x' * 5000 + b'\x1b]10;?\x07',
    ):
        exchange([ignored], b'')
    # Unsupported setters did not change the palette or foreground.
    exchange([b'\x1b]4;1;?\x07\x1b]10;?\x07'],
             b'\x1b]4;1;rgb:cdcd/0000/0000\x07\x1b]10;rgb:e5e5/e5e5/e5e5\x07')
    exchange([b'\x1b]4;21;?;52;?;231;?;232;?\x07'],
             b'\x1b]4;21;rgb:0000/0000/ffff\x07'
             b'\x1b]4;52;rgb:5f5f/0000/0000\x07'
             b'\x1b]4;231;rgb:ffff/ffff/ffff\x07'
             b'\x1b]4;232;rgb:0808/0808/0808\x07')
    (root / 'peer-result.json').write_text(json.dumps({'success': True, 'cases': cases}))
except Exception as error:
    (root / 'peer-result.json').write_text(json.dumps({'success': False, 'cases': cases, 'error': str(error)}))
    sys.exit(1)
finally:
    sent.close()
    received.close()
