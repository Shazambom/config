#!/usr/bin/env python3
"""Manual physical-key acceptance journey, not a synthetic-key simulation."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def signature(value):
    return hashlib.sha256(value.encode()).hexdigest()


async def wait_state(folder, predicate, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = await request(folder, 'state')
        if state['submissions'] or state['overlaySubmissions']:
            raise AssertionError('input submitted during copy/paste')
        if predicate(state):
            return state
        await asyncio.sleep(.15)
    raise RuntimeError('BLOCKED: manual action/state timed out')


async def wait_event(folder, predicate, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            for line in reversed((folder / 'events.jsonl').read_text().splitlines()):
                row = json.loads(line)
                if predicate(row):
                    return row
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        await asyncio.sleep(.1)
    raise RuntimeError('BLOCKED: installed Pi did not acknowledge fixture command')


async def request(folder, action, **details):
    identifier = str(uuid.uuid4())
    target = folder / 'request.json'
    temporary = folder / 'request.tmp'
    temporary.write_text(json.dumps(dict(id=identifier, action=action, **details)))
    temporary.replace(target)
    if action == 'stop':
        return
    return await wait_event(folder, lambda row: row.get('id') == identifier)


async def journey(connection, cli, bootstrap=False, native_menu=False, candidate=False):
    import iterm2
    work = Path(tempfile.mkdtemp(prefix='pi-universal-'))
    work.chmod(0o700)
    socket = str(work / 'tmux.sock')
    tmux = shutil.which('tmux')
    app = await iterm2.async_get_app(connection)
    baseline_windows = {item.window_id for item in app.windows}
    window = None
    fixture = work / 'repo'
    contexts = ('new', 'existing', 'resumed', 'reattached', 'split')
    results = [dict(context=context, surface=surface, cycle=cycle, result='NOT_RUN')
               for context in contexts
               for surface in ('overlay', 'transcript', 'editor') for cycle in (1, 2)
               if surface == 'editor' or cycle == 1]
    active_case = None
    async def wait_selection(folder, wanted):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            state = await request(folder, 'state')
            await app.async_refresh()
            owned = app.get_window_by_id(window.window_id)
            native = False
            if owned and owned.current_tab and owned.current_tab.current_session:
                selection = await owned.current_tab.current_session.async_get_selection()
                native = any((part.windowed_coord_range.start.x, part.windowed_coord_range.start.y) !=
                             (part.windowed_coord_range.end.x, part.windowed_coord_range.end.y)
                             for part in selection.sub_selections)
            if bool(state['selected'] or native) == wanted:
                state['nativeSelection'] = native
                return state
            await asyncio.sleep(.15)
        raise RuntimeError('BLOCKED: no expected Pi or native iTerm selection bounds')
    def tm(*args):
        return run(tmux, '-S', socket, *args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout.strip()
    def launch(name, identity=None):
        folder = work / name
        folder.mkdir()
        if identity is None:
            identity = str(uuid.uuid4())
            run('env', '-i', 'HOME=' + str(work / 'home'), 'PATH=' + os.environ['PATH'],
                'PI_CODING_AGENT_DIR=' + str(work / 'agent'), shutil.which('node'),
                '--import', str(HERE / 'offline.mjs'), str(HERE / 'seed.mjs'),
                str(Path(cli).resolve().parents[1] / 'core/session-manager.js'),
                str((work / 'cwd').resolve()), identity)
        env = ['env', '-i', 'HOME=' + str(work / 'home'), 'PATH=' + os.environ['PATH'],
               'TERM=xterm-256color', 'PI_CODING_AGENT_DIR=' + str(work / 'agent'),
               'PI_UNIVERSAL_CASE=' + str(folder),
               'PI_UNIVERSAL_TUI=' + (Path(cli).resolve().parents[2] / 'node_modules/@earendil-works/pi-tui/dist/index.js').as_uri(),
               'PI_OFFLINE=1', 'PI_SKIP_VERSION_CHECK=1',
               shutil.which('node'), '--import', str(HERE / 'offline.mjs'), cli,
               '--session-id', identity, '--no-context-files', '--no-skills',
               '--no-prompt-templates', '--no-tools', '-e', str(HERE / 'probe.mjs')]
        binary = folder / 'bin'
        binary.mkdir()
        for name, script in {
            'pi': '#!/bin/bash\ncd ' + shlex.quote(str(work / 'cwd')) + '\nexec ' + shlex.join(env) + '\n',
            'tmux': '#!/bin/bash\nexec ' + shlex.join([tmux, '-S', socket, '-f', '/dev/null']) + ' "$@"\n',
        }.items():
            path = binary / name
            path.write_text(script)
            path.chmod(0o700)
        return folder, identity, 'PATH=' + shlex.quote(str(binary) + ':' + os.environ['PATH']) + ' ' + shlex.quote(str(fixture / 'pi.sh'))
    try:
        for directory in ('home', 'cwd', 'agent/extensions', 'repo/pi', 'repo/iterm2'):
            (work / directory).mkdir(parents=True)
        shutil.copy2(REPO / 'pi.sh', fixture / 'pi.sh')
        shutil.copy2(REPO / 'pi/command-path.sh', fixture / 'pi/command-path.sh')
        for name in ('launch.sh', 'reorder.py'):
            shutil.copy2(REPO / 'iterm2' / name, fixture / 'iterm2' / name)
        for name in ('runtime.sh', 'jq.sh'):
            (fixture / 'pi' / name).write_text('')
        (fixture / 'init.sh').write_text('#!/bin/bash\nexit 0\n')
        (fixture / 'init.sh').chmod(0o700)
        shutil.copytree(REPO / 'pi/agent/themes', work / 'agent/themes')
        shutil.copy2(REPO / 'pi/agent/keybindings.json', work / 'agent/keybindings.json')
        for extension in ('selection-copy.ts', 'vim-scroll.ts'):
            source = REPO / 'pi/agent/extensions' / extension
            if source.exists():
                shutil.copy2(source, work / 'agent/extensions' / extension)
        vim_ref = run('jq', '-r', '.[]|select(.name=="pi-vimmode")|.ref', str(REPO / 'pi/upstream.json'), capture_output=True, text=True).stdout.strip()
        vim = REPO / 'pi/upstream' / ('pi-vimmode-' + vim_ref)
        if not vim.is_dir():
            raise RuntimeError('BLOCKED: installed Vim package missing')
        with (work / 'agent/settings.json').open('w') as output:
            run('jq', '--arg', 'vim', str(vim),
                '.packages=[{source:$vim,skills:[],prompts:[],themes:[]}] | .extensions=[] | .skills=[] | .prompts=[] | .compaction.enabled=false | .["observational-memory"].enabled=false | .defaultProjectTrust="never"',
                str(REPO / 'pi/agent/settings.json'), stdout=output)
        folder, identity, command = launch('new')
        # Actual root-launch path, with setup stubbed and tmux socket isolated.
        shell = 'unset TMUX TMUX_PANE CONFIG_PI_HOME; ' + command + '; exec /bin/bash --noprofile --norc'
        profile = iterm2.LocalWriteOnlyProfile({'Initial Text': ''})
        profile.set_name('Pi universal synthetic test')
        profile.set_use_custom_command(iterm2.Profile.USE_CUSTOM_COMMAND_ENABLED)
        profile.set_command('/bin/bash --noprofile --norc -c ' + shlex.quote(shell))
        print('Opening ONE owned iTerm2 window. ' + ('Native menu mode will focus its owned sessions; do not type during this run.' if native_menu else 'Select it manually; later pane switches are manual.'), flush=True)
        window = await iterm2.Window.async_create(connection, profile_customizations=profile)
        if window is None:
            raise RuntimeError('BLOCKED: iTerm2 window unavailable')
        (work / 'owned.json').write_text(json.dumps({'window': window.window_id, 'socket': socket, 'preexisting_window_ids': sorted(baseline_windows)}))
        print('Owned window:', window.window_id, 'private socket:', socket, flush=True)
        initial_ready = await wait_event(folder, lambda row: row.get('event') == 'ready')
        pane = tm('list-panes', '-a', '-F', '#{pane_id}').splitlines()[0]
        tm('set-option', '-g', 'remain-on-exit', 'on')
        for context in contexts:
            if context == 'existing':
                folder, identity, command = launch(context)
                fifo = folder / 'start.fifo'
                os.mkfifo(fifo)
                shell_command = 'IFS= read -r command < ' + shlex.quote(str(fifo)) + '; eval "$command"'
                pane = tm('new-window', '-d', '-P', '-F', '#{pane_id}', '/bin/bash -c ' + shlex.quote(shell_command))
                await asyncio.to_thread(fifo.write_text, command + '\n')
                initial_ready = await wait_event(folder, lambda row: row.get('event') == 'ready')
            elif context == 'resumed':
                await request(folder, 'stop')
                # Wait for owned Pi to exit, rather than kill during a session write.
                deadline = time.monotonic() + 10
                while tm('display-message', '-p', '-t', pane, '#{pane_dead}') != '1':
                    if time.monotonic() > deadline:
                        raise RuntimeError('BLOCKED: session did not stop cleanly')
                    await asyncio.sleep(.1)
                folder, _, command = launch(context, identity)
                tm('respawn-pane', '-t', pane, command)
            elif context == 'reattached':
                guard = iterm2.LocalWriteOnlyProfile({'Initial Text': ''})
                guard.set_use_custom_command(iterm2.Profile.USE_CUSTOM_COMMAND_ENABLED)
                guard.set_command('/bin/bash --noprofile --norc')
                await window.async_create_tab(profile_customizations=guard)
                tm('detach-client', '-s', tm('display-message', '-p', '-t', pane, '#{session_name}'))
                if tm('list-clients'):
                    raise AssertionError('private client remained attached; reattach case is invalid')
                attach = 'unset TMUX TMUX_PANE; ' + shlex.join([tmux, '-S', socket, '-CC', 'attach-session']) + '; exec /bin/bash --noprofile --norc'
                guard.set_command('/bin/bash --noprofile --norc -c ' + shlex.quote(attach))
                await window.async_create_tab(profile_customizations=guard)
                deadline = time.monotonic() + 20
                while not tm('list-clients', '-F', '#{client_control_mode}'):
                    if time.monotonic() > deadline:
                        raise RuntimeError('BLOCKED: native tmux reattach timed out')
                    await asyncio.sleep(.1)
            elif context == 'split':
                folder, _, command = launch(context)
                pane = tm('split-window', '-d', '-P', '-F', '#{pane_id}', '-t', pane, command)
            ready = await wait_event(folder, lambda row: row.get('event') == 'ready')
            if context == 'resumed' and (ready['session'] != identity or ready['file'] != initial_ready['file'] or ready['history'] <= initial_ready['history']):
                raise AssertionError('resume did not retain saved file and synthetic history')
            if bootstrap:
                for surface in ('overlay', 'transcript', 'editor'):
                    await request(folder, 'prepare', surface=surface, text='PI_SYNTHETIC_BOOTSTRAP')
                    state = await request(folder, 'state')
                    if surface == 'overlay' and state['overlay'] is not True:
                        raise AssertionError('fixture overlay did not open')
                print('BOOTSTRAP reachable:', context, 'saved history:', ready['history'], flush=True)
                continue
            for active_case in (row for row in results if row['context'] == context):
                surface, cycle = active_case['surface'], active_case['cycle']
                ending = '\n' if cycle == 2 else ''
                active_case['result'] = 'IN_PROGRESS'
                print('CASE:', context, pane, surface, cycle, flush=True)
                text = 'PI_SYNTHETIC_' + context + '_' + surface + '_' + str(cycle)
                if surface != 'overlay':
                    text += '\nsecond line' + ending
                await request(folder, 'prepare', surface=surface, text=text)
                if native_menu:
                    from native import exercise
                    evidence = await exercise(connection, app, window, folder, text, surface, candidate, request, run, signature, baseline_windows)
                    active_case.update(result='PASS', **evidence)
                    active_case = None
                    print('PASS native menu case:', context, surface, cycle, flush=True)
                    continue
                marker = 'PI_SYNTHETIC_UNCOPIED_' + str(uuid.uuid4())
                run('pbcopy', input=marker.encode())  # First clipboard operation is a write.
                await request(folder, 'instruction', text=f'{context}/{surface}/{cycle}: click once to clear any previous selection')
                await wait_selection(folder, False)
                suffix = ' INCLUDE trailing newline' if cycle == 2 and surface != 'overlay' else ''
                await request(folder, 'instruction', text='Highlight ONLY the PI_SYNTHETIC fixture.' + suffix + ' WAIT before Cmd+C')
                state = await wait_selection(folder, True)
                expected = text
                if state.get('nativeSelection'):
                    from native import manual_expectation
                    expected = await manual_expectation(app, window, text)
                await asyncio.sleep(.3)
                if run('pbpaste', capture_output=True).stdout != marker.encode():
                    raise AssertionError('drag alone changed clipboard; content withheld')
                if surface == 'overlay' and state['overlay'] is not True:
                    raise RuntimeError('BLOCKED: fixture overlay is not active')
                await request(folder, 'instruction', text='Now press physical Cmd+C once. Do not change selection.')
                deadline = time.monotonic() + 90
                while True:
                    copied = run('pbpaste', capture_output=True).stdout
                    if copied == expected.encode():
                        break
                    if copied != marker.encode():
                        raise AssertionError('copy differs from selected fixture; content withheld')
                    observed = await request(folder, 'state')
                    if observed['copyKeys'] > state['copyKeys']:
                        await asyncio.sleep(.5)
                        if run('pbpaste', capture_output=True).stdout != expected.encode():
                            raise AssertionError('Cmd+C received but selected fixture not copied')
                        break
                    if time.monotonic() > deadline:
                        raise RuntimeError('BLOCKED: no physical copy observed within 90 seconds')
                    await asyncio.sleep(.15)
                after_copy = await request(folder, 'state')
                if any(after_copy[key] != state[key] for key in ('sha256', 'bytes', 'submissions')):
                    raise AssertionError('copy changed the draft or submitted input')
                await request(folder, 'clear')
                await request(folder, 'instruction', text='Press physical Cmd+V into ' + ('the focused overlay Input' if surface == 'overlay' else 'the main editor') + '. Do NOT press Enter.')
                deadline = time.monotonic() + 90
                while True:
                    after = await request(folder, 'state')
                    if after['submissions'] or after['overlaySubmissions']:
                        raise AssertionError('paste submitted input')
                    if after['focusedSha256'] == signature(expected) and after['focusedBytes'] == len(expected.encode()):
                        break
                    if after['pasteKeys'] > after_copy['pasteKeys'] or after['focusedBytes']:
                        await asyncio.sleep(.5)
                        after = await request(folder, 'state')
                        if after['focusedSha256'] != signature(expected):
                            raise AssertionError('paste observed but focused value differs; content withheld')
                        break
                    if time.monotonic() > deadline:
                        raise RuntimeError('BLOCKED: no physical paste observed within 90 seconds')
                    await asyncio.sleep(.15)
                await asyncio.sleep(.5)
                await wait_state(folder, lambda row: row['focusedSha256'] == signature(expected), timeout=2)
                if surface == 'overlay' and after['bytes'] != 0:
                    raise AssertionError('overlay paste leaked into main editor')
                active_case.update(result='PASS', delivery='operator-attested physical Cmd+C/V')
                active_case = None
                print('PASS case:', context, surface, cycle, flush=True)
            await request(folder, 'instruction', text='Context complete. Select the next test tab/pane shown by the controller.')
        if bootstrap:
            print('PASS BOOTSTRAP ONLY: contexts and overlay reachable; no clipboard or physical keys tested.')
        else:
            print('PASS: 20-case new/existing/resumed/reattached/split matrix. ' + ('Native menu-handler proof only; physical Cmd/drag/wheel UNVERIFIED. ' + ('Candidate overrides, NOT deployment proof.' if candidate else 'Inherited deployed profiles, no candidate overrides.') if native_menu else 'Physical keys supplied by operator.'))
        return 0
    except AssertionError as error:
        print('FAIL:', error, flush=True)
        if active_case is not None:
            active_case.update(result='FAIL', reason=str(error))
        raise
    except BaseException as error:
        if active_case is not None:
            active_case.update(result='BLOCKED', reason=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        if isinstance(error, RuntimeError):
            print(str(error), flush=True)
        raise
    finally:
        (work / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        print('Synthetic-only artifacts:', work, flush=True)
        subprocess.run([tmux, '-S', socket, 'kill-server'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        await asyncio.wait_for(app.async_refresh(), timeout=5)
        if window:
            owned = app.get_window_by_id(window.window_id)
            if owned:
                await asyncio.wait_for(owned.async_close(force=True), timeout=5)
        # Never restore focus here: the user may have switched windows while testing.
        # Clipboard remains synthetic. Never read/save/restore the prior contents.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', required=True)
    parser.add_argument('--live-manual', action='store_true')
    parser.add_argument('--replace-clipboard', action='store_true')
    parser.add_argument('--bootstrap', action='store_true')
    parser.add_argument('--native-menu', action='store_true')
    parser.add_argument('--candidate-profile', action='store_true')
    args = parser.parse_args()
    if not (args.bootstrap or ((args.live_manual or args.native_menu) and args.replace_clipboard)) or (args.candidate_profile and not args.native_menu):
        print('BLOCKED: explicit live/clipboard flags required')
        return 77
    if not args.bootstrap:
        print('WARNING: live run replaces the OS clipboard with synthetic fixtures. Save it yourself first; previous contents are never read or restored.')
    import iterm2
    outcome = 77
    async def connected(connection):
        nonlocal outcome
        try:
            outcome = await journey(connection, args.cli, args.bootstrap, args.native_menu, args.candidate_profile)
        except AssertionError as error:
            print('FAIL:', error)
            outcome = 1
        except Exception as error:
            print('BLOCKED: live journey could not complete:', type(error).__name__)
            outcome = 77
    try:
        iterm2.run_until_complete(connected, retry=False)
    except AssertionError as error:
        print('FAIL:', error)
        return 1
    except Exception as error:
        # No command output, terminal contents, or clipboard data in errors.
        print('BLOCKED: live journey could not complete:', type(error).__name__)
        return 77
    return outcome


if __name__ == '__main__':
    raise SystemExit(main())
