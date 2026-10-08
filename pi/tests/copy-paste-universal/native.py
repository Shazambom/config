"""Native menu-handler proof. No physical Cmd or drag simulation claims."""
import asyncio
import json
import time
import uuid

FLAGS = {'Mouse Reporting': True, 'Mouse Reporting allow mouse wheel': True,
         'Mouse Reporting allow clicks and drags': False}


def rendered_expectation(rows, row, column, text):
    """Expected native Copy bytes from known source and verified visible gutters."""
    pieces = text.split('\n')
    prefixes = []
    for index, piece in enumerate(pieces):
        line = rows[row + index]
        prefix = line[:column]
        if prefix.strip(' ') not in ('', '│', '┃', '▌'):
            raise AssertionError('unrecognized visible fixture gutter')
        if line[column:column + len(piece)] != piece:
            raise AssertionError('rendered fixture row does not match synthetic source')
        if not piece and line[column:].strip(' │┃▌'):
            raise AssertionError('expected trailing blank fixture row is not blank')
        prefixes.append(prefix)
    expected = pieces[0] + ''.join('\n' + (prefixes[index] + pieces[index]).rstrip(' ')
                                         for index in range(1, len(pieces)))
    return expected, prefixes


async def manual_expectation(app, window, text):
    """Read only the owned fixture's geometry; never use copied text as oracle."""
    await app.async_refresh()
    owned = app.get_window_by_id(window.window_id)
    if not owned or not owned.current_tab or not owned.current_tab.current_session:
        raise RuntimeError('owned manual selection session unavailable')
    target = owned.current_tab.current_session
    screen = await target.async_get_screen_contents()
    selection = await target.async_get_selection()
    if len(selection.sub_selections) != 1:
        raise AssertionError('select one contiguous synthetic fixture')
    region = selection.sub_selections[0].windowed_coord_range
    pieces = text.split('\n')
    expected_end_x = region.start.x + len(pieces[-1])
    if region.end.y != region.start.y + len(pieces) - 1 or (region.end.x != expected_end_x and not (pieces[-1] == '' and region.end.x == 0)):
        raise AssertionError('manual selection does not span exactly the synthetic fixture')
    rows = [screen.line(index).string for index in range(screen.number_of_lines)]
    expected, _ = rendered_expectation(rows, region.start.y - screen.windowed_coord_range.start.y, region.start.x, text)
    return expected


async def exercise(connection, app, window, folder, text, surface, candidate, request, run, signature, baseline_windows):
    import iterm2
    # Read only the owned synthetic window, never another application's terminal.
    deadline = time.monotonic() + 15
    target = None
    first = text.split('\n')[0]
    while time.monotonic() < deadline and target is None:
        await app.async_refresh()
        owned = app.get_window_by_id(window.window_id)
        if owned is None:
            raise RuntimeError('owned window disappeared')
        for tab in owned.tabs:
            if not tab.tmux_connection_id:
                continue
            for session in tab.sessions:
                screen = await session.async_get_screen_contents()
                rows = [screen.line(index).string for index in range(screen.number_of_lines)]
                hits = [(index, line.index(first)) for index, line in enumerate(rows) if first in line]
                if hits:
                    target = session
                    row, column = hits[-1]
                    break
            if target:
                break
        if target is None:
            await asyncio.sleep(.1)
    if target is None:
        raise RuntimeError('synthetic selection fixture not visible')
    properties = (await target.async_get_profile()).all_properties
    if candidate and any(properties.get(name) != value for name, value in FLAGS.items()):
        await target.async_set_profile_properties(iterm2.LocalWriteOnlyProfile(FLAGS))
        await asyncio.sleep(1)
    properties = (await target.async_get_profile()).all_properties
    actual = {name: properties.get(name) for name in FLAGS}
    if actual != FLAGS:
        raise AssertionError('native profile prerequisite differs: ' + repr(actual))
    # Explicit live mode permits targeting this owned session. Menu calls below
    # abort if focus moves elsewhere rather than silently copying another window.
    await app.async_refresh()
    current = app.current_terminal_window
    if not current or current.window_id != window.window_id or not current.current_tab or current.current_tab.current_session.session_id != target.session_id:
        await target.async_activate()
    if not app.app_active:
        await app.async_activate(raise_all_windows=False)
    focus_deadline = time.monotonic() + 5
    while True:
        await app.async_refresh()
        current = app.current_terminal_window
        if app.app_active and current and current.window_id == window.window_id and current.current_tab and current.current_tab.current_session.session_id == target.session_id:
            break
        if time.monotonic() > focus_deadline:
            raise RuntimeError('owned focus did not settle after activation')
        await asyncio.sleep(.1)
    # Profile and activation can resize/repaint. Never select cached coordinates.
    await asyncio.sleep(.3)
    screen = await target.async_get_screen_contents()
    rows = [screen.line(index).string for index in range(screen.number_of_lines)]
    hits = [(index, line.index(first)) for index, line in enumerate(rows) if first in line]
    if len(hits) != 1:
        raise RuntimeError('fresh owned screen does not uniquely contain fixture')
    row, column = hits[0]
    async def menu(identifier):
        await app.async_refresh()
        current = app.current_terminal_window
        if not app.app_active or not current or current.window_id != window.window_id or not current.current_tab or current.current_tab.current_session.session_id != target.session_id:
            with (folder / 'native-observations.jsonl').open('a') as output:
                output.write(json.dumps({'focus_guard': identifier, 'app_active_now': app.app_active,
                    'expected_window': window.window_id, 'actual_window': current.window_id if current else None,
                    'actual_window_was_preexisting': current.window_id in baseline_windows if current else None,
                    'expected_session': target.session_id,
                    'actual_session': current.current_tab.current_session.session_id if current and current.current_tab and current.current_tab.current_session else None}) + '\n')
            raise RuntimeError('focus moved away from owned selection; menu action refused')
        enabled = await asyncio.wait_for(iterm2.MainMenu.async_get_menu_item_state(connection, identifier), timeout=5)
        if not enabled.enabled:
            current_selection = await target.async_get_selection()
            with (folder / 'native-observations.jsonl').open('a') as output:
                output.write(json.dumps({'disabled_menu': identifier, 'app_active_now': app.app_active,
                    'current_selection_bounds': [[part.windowed_coord_range.start.x, part.windowed_coord_range.start.y,
                        part.windowed_coord_range.end.x, part.windowed_coord_range.end.y]
                        for part in current_selection.sub_selections]}) + '\n')
            raise RuntimeError('BLOCKED: native ' + identifier + ' menu disabled in owned session after selection validation')
        await asyncio.wait_for(iterm2.MainMenu.async_select_menu_item(connection, identifier), timeout=5)
    await target.async_set_selection(iterm2.Selection([]))
    marker = 'PI_SYNTHETIC_NATIVE_UNCOPIED_' + str(uuid.uuid4())
    run('pbcopy', input=marker.encode())
    # ASCII fixtures make terminal columns deterministic. Use a contiguous native
    # character selection, not synthetic text delivery or disjoint line selections.
    pieces = text.split('\n')
    last = len(pieces) - 1
    # Independent visible-selection oracle. Contiguous native selection includes
    # the rendered gutter on subsequent lines. Native Copy trims right-padding,
    # not left gutters. Never derive the expected bytes from clipboard/readback.
    expected, prefixes = rendered_expectation(rows, row, column, text)
    start_y = screen.windowed_coord_range.start.y + row
    end_column = column + len(pieces[-1])
    region = iterm2.WindowedCoordRange(
        iterm2.CoordRange(iterm2.Point(column, start_y), iterm2.Point(end_column, start_y + last)))
    selection = iterm2.Selection([iterm2.SubSelection(region, iterm2.SelectionMode.CHARACTER, False)])
    await target.async_set_selection(selection)
    await asyncio.sleep(.2)
    readback = await target.async_get_selection()
    selected = await readback.async_get_string(connection, target.session_id, target.grid_size.width)
    observations = {'surface': surface, 'app_active': app.app_active, 'screen_origin': screen.windowed_coord_range.start.y,
                    'lines_above_screen': screen.number_of_lines_above_screen,
                    'requested': [column, start_y, end_column, start_y + last],
                    'hard_eol': [screen.line(row + index).hard_eol for index in range(last + 1)],
                    'readback_bounds': [[part.windowed_coord_range.start.x, part.windowed_coord_range.start.y,
                                         part.windowed_coord_range.end.x, part.windowed_coord_range.end.y]
                                        for part in readback.sub_selections],
                    'selected_length': len(selected), 'expected_length': len(expected),
                    'source_sha256': signature(text), 'rendered_prefixes': prefixes,
                    'selected_sha256': signature(selected), 'expected_sha256': signature(expected)}
    known_rendered = [line.strip() for line in selected.split('\n')] == [line.strip() for line in text.split('\n')]
    if known_rendered or selected in (text, text.replace('\n', ''), text + '\n', ''):
        observations.update(expected_repr=repr(expected), selected_repr=repr(selected))
    with (folder / 'native-observations.jsonl').open('a') as output:
        output.write(json.dumps(observations) + '\n')
    if selected != text and not known_rendered:
        raise AssertionError('native selection readback differs before Copy; inspect synthetic native-observations.jsonl')
    if run('pbpaste', capture_output=True).stdout != marker.encode():
        raise AssertionError('native selection alone copied text')
    before = await request(folder, 'state')
    await menu('Copy')
    copied = run('pbpaste', capture_output=True).stdout
    if copied != expected.encode():
        decoded = copied.decode('utf-8', errors='replace')
        if [line.strip() for line in decoded.split('\n')] == [line.strip() for line in text.split('\n')]:
            with (folder / 'native-observations.jsonl').open('a') as output:
                output.write(json.dumps({'native_copy_known_fixture_repr': repr(decoded)}) + '\n')
        raise AssertionError('native Copy bytes differ: expected length ' + str(len(expected.encode())) + ', actual length ' + str(len(copied)))
    after_copy = await request(folder, 'state')
    if any(before[key] != after_copy[key] for key in ('sha256', 'bytes', 'submissions', 'overlaySubmissions')):
        raise AssertionError('native Copy changed draft or submitted input')
    await request(folder, 'clear')
    await target.async_set_selection(iterm2.Selection([]))
    await menu('Paste')
    deadline = time.monotonic() + 10
    while True:
        state = await request(folder, 'state')
        if state['submissions'] or state['overlaySubmissions']:
            raise AssertionError('native Paste submitted input')
        if state['focusedSha256'] == signature(expected) and state['focusedBytes'] == len(expected.encode()):
            break
        if time.monotonic() > deadline:
            raise AssertionError('native Paste did not reach actual focused value unchanged')
        await asyncio.sleep(.1)
    await asyncio.sleep(.4)
    state = await request(folder, 'state')
    if state['submissions'] or state['overlaySubmissions'] or state['focusedSha256'] != signature(expected):
        raise AssertionError('native Paste changed or submitted after settling')
    if surface == 'overlay' and state['bytes']:
        raise AssertionError('native overlay Paste leaked into main editor')
    return {'delivery': 'native iTerm Selection API + Edit Copy/Paste menu handlers; NOT physical Cmd/drag',
            'profile': 'candidate session override' if candidate else 'inherited deployed profile',
            'mouse_flags': actual, 'physical_wheel': 'UNVERIFIED: profile permits wheel; no wheel gesture injected'}
