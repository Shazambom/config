#!/usr/bin/env bash
# All resources are private, inventoried and retained. Never source common.sh.
set -euo pipefail
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
source "$repo/pi/command-path.sh"
fail() { echo "ERROR: $*" >&2; exit 1; }
valid() { [[ "$1" =~ ^[a-zA-Z][a-zA-Z0-9_-]{0,39}$ ]] || fail 'Invalid resource name'; }
resolve() {
  local target cli hash
  if [[ $# == 0 ]]; then target="$(command -v pi)";
  elif [[ $# == 2 && $1 == --cli ]]; then target="$2";
  else fail 'Use --cli executable-or-package'; fi
  if [[ -d "$target" ]]; then target="$target/$(jq -er '.bin.pi' "$target/package.json")"; fi
  cli="$(pi_real_command "$target")"
  hash="$(shasum -a 256 "$cli" | awk '{print $1}')"
  jq -n --arg cli "$cli" --arg sha256 "$hash" '{cli:$cli,sha256:$sha256}'
}
if [[ ${1:-help} == help ]]; then
  printf '%s\n' 'Private lifecycle lab controls' \
    'create [--cli executable-or-package] [--extension PATH] -> JSON with id, cwd and evidence' \
    'Repeat --extension to explicitly load trusted test extensions; default remains bare Pi.' \
    'resolve [--cli executable-or-package]' \
    'attach ID CLIENT                     attach a private terminal client' \
    'open ID CONVERSATION                 open a saved conversation in a new named instance' \
    'fresh ID CONVERSATION INSTANCE       open a separate instance on the same saved conversation' \
    'reconnect ID INSTANCE                show an already running instance' \
    'Use INSTANCE with screen/type/key/saved/switch after fresh.' \
    'screen ID CONVERSATION               show current terminal text' \
    'type ID CONVERSATION TEXT            type literal text without submitting' \
    'key ID CONVERSATION KEY              Enter, Escape, C-c, C-d, C-r, Up, Down, Tab' \
    'switch ID CLIENT CONVERSATION|away   change visible window without disconnecting' \
    'resize ID CLIENT COLS ROWS           resize a private terminal' \
    'detach ID CLIENT                     disconnect a client' \
    'close ID CLIENT                      close its private terminal' \
    'saved ID CONVERSATION                read saved user/assistant text' \
    'status ID                            process liveness, attached count and receipts' \
    'cleanup ID                           bounded cleanup, retains evidence' \
    'Names use letters, numbers, underscores and hyphens, starting with a letter.' \
    'Attach a client before opening a conversation. Use only synthetic input.' \
    'The local provider echoes input. No real credentials are used.' \
    'Type slow TEXT and Enter for a visible 15-second reply; Escape cancels it.' \
    'A slow reply begins with LAB_STARTED, then LAB_CHUNK, and ends with LAB_DONE.' \
    'Chat input excludes !, @, control bytes and slash commands except /quit, /exit, /session, /resume, /new, /reload, /help, /hotkeys.' \
    'No shell, external editor, login, browser, clipboard, selection, paste or GUI controls.' \
    'Environment isolation is not an OS sandbox. Only run trusted candidate executables.'
  exit
fi
op="$1"; shift
if [[ $op == resolve ]]; then resolve "$@"; exit; fi
# A fixed per-UID inventory, not an operator-supplied path. /tmp avoids UNIX socket length limits.
registry="/tmp/pi-lifecycle-$(id -u)"
if [[ ! -e "$registry" ]]; then mkdir -m 700 "$registry"; fi
[[ -d "$registry" && -O "$registry" && ! -L "$registry" ]] || fail 'Unsafe inventory'
case "$(uname -s)" in
  Darwin) permissions="$(stat -f %Lp "$registry")" ;;
  Linux) permissions="$(stat -c %a "$registry")" ;;
  *) fail 'Supported hosts: macOS and Linux' ;;
esac
[[ "$permissions" == 700 ]] || fail 'Inventory permissions must be 700'
node="$(command -v node)"; tmux_bin="$(command -v tmux)"; python="$(command -v python3)"; bash_bin="$(command -v bash)"
if [[ $op == create ]]; then
  selected_cli=''; extensions='[]'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cli)
        [[ $# -ge 2 && -z "$selected_cli" && -n "$2" ]] || fail 'Supply one --cli executable-or-package'
        selected_cli="$2"; shift 2 ;;
      --extension)
        [[ $# -ge 2 && -f "$2" ]] || fail 'Supply --extension with an existing trusted file'
        extension="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"
        extensions="$(jq -c --arg path "$extension" '. + [$path]' <<< "$extensions")"
        shift 2 ;;
      *) fail 'create accepts --cli and --extension only' ;;
    esac
  done
  if [[ -n "$selected_cli" ]]; then resolved="$(resolve --cli "$selected_cli")"; else resolved="$(resolve)"; fi
  resolved="$(jq --argjson extensions "$extensions" '. + {extensions:$extensions}' <<< "$resolved")"
  work="$(mktemp -d "$registry/lab.XXXXXXXX")"; id="${work##*/}"
  mkdir "$work/home" "$work/agent" "$work/cwd" "$work/actors" "$work/clients" "$work/conversations" "$work/histories"
  printf '%s\n' "$id" > "$work/owned"
else
  [[ $# -ge 1 ]] || fail 'Missing lab ID'
  id="$1"; shift
  [[ "$id" =~ ^lab\.[a-zA-Z0-9]{8}$ ]] || fail 'Invalid lab ID'
  work="$registry/$id"
  [[ -d "$work" && -O "$work" && ! -L "$work" && -f "$work/owned" && ! -L "$work/owned" && "$(< "$work/owned")" == "$id" ]] || fail 'Unowned lab'
fi
socket="$work/tmux.sock"
armed=false
failure_cleanup() {
  local result=$?
  trap - EXIT
  if [[ $result != 0 && $armed == true ]]; then
    event controller-failure "$op exit $result"
    echo "Controller failed; retained evidence: $work; running bounded cleanup" >&2
    if [[ $op == open || $op == fresh ]]; then
      # Roll back only the attempted opener. Other instances may be legitimate
      # owners; a launcher failure is not permission to tear down their server.
      if [[ -f "$work/actors/pi-$name.json" ]] && stop_actor "$work/actors/pi-$name.json"; then
        event opener-rollback "$name"
      else
        echo 'ERROR: opener cleanup ambiguous; existing lab left intact' >&2
        result=2
      fi
    elif ! bash "$here/lab.sh" cleanup "$id" > "$work/failure-cleanup.json" 2> "$work/failure-cleanup.log"; then
      echo "ERROR: cleanup incomplete; inspect $work/failure-cleanup.log" >&2
      result=2
    fi
  fi
  exit "$result"
}
trap failure_cleanup EXIT
clean_env=(env -i "HOME=$work/home" "PATH=$PATH" TERM=xterm-256color "SHELL=$bash_bin" "PI_CODING_AGENT_DIR=$work/agent" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 "LIFECYCLE_LAB=$work" "NODE_OPTIONS=--import=$here/provider.mjs")
event() { jq -nc --arg event "$1" --arg detail "${2:-}" --arg actor "$$" '{time:(now*1000),actor:$actor,event:$event,detail:$detail}' >> "$work/events.jsonl"; }
identity() { ps -p "$1" -o lstart= -o command= 2>/dev/null; }
process_cwd() {
  if [[ -e "/proc/$1/cwd" ]]; then readlink "/proc/$1/cwd";
  else lsof -a -p "$1" -d cwd -Fn 2>/dev/null | awk '/^n/ {print substr($0,2)}'; fi
}
remember() {
  local role="$1" pid="$2" expected_cwd="${3:-}" ident actual_cwd
  # Persist a pending PID receipt before inspecting a potentially short-lived actor.
  jq -n --arg role "$role" --argjson pid "$pid" --arg cwd "$expected_cwd" '{role:$role,pid:$pid,identity:"",start:"",cwd:$cwd,pending:true}' > "$work/actors/$role.json"
  ident="$(identity "$pid" || true)"
  if [[ -z "$ident" ]]; then event actor-exited-before-registration "$role pid=$pid"; return; fi
  if [[ $role == pi-* ]]; then
    actual_cwd="$(process_cwd "$pid" || true)"
    if [[ "$actual_cwd" != "$expected_cwd" && "$actual_cwd" != "/private$expected_cwd" ]]; then
      local presence=0
      "$node" "$here/process-presence.mjs" "$pid" || presence=$?
      [[ $presence == 1 ]] && { event actor-exited-before-registration "$role pid=$pid"; return; }
      fail "Actor lacks incarnation identity: $role"
    fi
  else [[ "$ident" == *"$work"* ]] || fail "Actor lacks run identity: $role"; fi
  jq -n --arg role "$role" --argjson pid "$pid" --arg identity "$ident" --arg start "${ident:0:24}" --arg cwd "$expected_cwd" '{role:$role,pid:$pid,identity:$identity,start:$start,cwd:$cwd}' > "$work/actors/$role.json"
  event actor "$(< "$work/actors/$role.json")"
}
# 0 alive, 1 exited, 2 identity mismatch. A zombie is an exited process, not a live actor.
life() {
  local file="$1" pid current state start presence=0
  pid="$(jq -r .pid "$file")"
  [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] || return 2
  # Start and command come from one coherent ps snapshot. Query failures are not
  # evidence of exit: only an OS ESRCH result establishes absence.
  if ! current="$(identity "$pid")" || [[ -z "$current" ]]; then
    "$node" "$here/process-presence.mjs" "$pid" || presence=$?
    [[ $presence == 1 ]] && return 1
    return 2
  fi
  if ! state="$(ps -p "$pid" -o stat= 2>/dev/null)" || [[ -z "$state" ]]; then
    "$node" "$here/process-presence.mjs" "$pid" || presence=$?
    [[ $presence == 1 ]] && return 1
    return 2
  fi
  "$node" "$here/process-presence.mjs" "$pid" || presence=$?
  [[ $presence != 1 ]] || return 1
  [[ $presence == 0 ]] || return 2
  [[ "$state" != *Z* ]] || return 1
  start="$(jq -r .start "$file")"
  # lstart's date occupies 24 characters; ps pads it differently alone/with argv.
  [[ "${current:0:24}" == "${start:0:24}" ]] || return 2
  if [[ "$(jq -r .role "$file")" == pi-* ]]; then
    # Pi changes its process title. Verify its unique cwd as well as start identity.
    local cwd expected_cwd
    expected_cwd="$(jq -r '.cwd // empty' "$file")"
    [[ "$expected_cwd" == "$work/instances/"* && -d "$expected_cwd" && ! -L "$expected_cwd" ]] || return 2
    cwd="$(process_cwd "$pid" || true)"
    if [[ "$cwd" != "$expected_cwd" && "$cwd" != "/private$expected_cwd" ]]; then
      # lsof/readlink can also race exit. A still-present mismatch remains an error.
      presence=0
      "$node" "$here/process-presence.mjs" "$pid" || presence=$?
      [[ $presence == 1 ]] && return 1
      return 2
    fi
  else
    [[ "$current" == "$(jq -r .identity "$file")" ]] || return 2
  fi
}
server() {
  local rc=0
  life "$work/actors/server.json" || rc=$?
  [[ $rc == 0 ]] || fail "Private server unavailable or identity changed ($rc)"
  [[ -S "$socket" && -O "$socket" && ! -L "$socket" ]] || fail 'Unsafe private socket'
}
tm() { server; "$tmux_bin" -S "$socket" "$@"; }
conversation() {
  valid "$1"
  [[ -f "$work/conversations/$1.json" && ! -L "$work/conversations/$1.json" ]] || fail 'Unknown conversation'
  pane="$(jq -r .pane "$work/conversations/$1.json")"
  [[ "$pane" =~ ^%[0-9]+$ ]] || fail 'Invalid pane inventory'
}
client() {
  valid "$1"
  [[ -f "$work/clients/$1/ready.json" && ! -L "$work/clients/$1" ]] || fail 'Unknown client'
  client_pid="$(jq -r .pid "$work/clients/$1/ready.json")"
}
attached_tty() { tm list-clients -F '#{client_pid} #{client_tty}' | awk -v pid="$client_pid" '$1==pid {print $2}'; }
stop_actor() {
  local file="$1" rc=0 pid i
  life "$file" || rc=$?
  [[ $rc != 2 ]] || { event cleanup-ambiguity "$file"; return 1; }
  [[ $rc == 0 ]] || return 0
  pid="$(jq -r .pid "$file")"
  event emergency-term "$(basename "$file")"
  kill -TERM "$pid"
  for ((i=0;i<30;i++)); do rc=0; life "$file" || rc=$?; [[ $rc != 0 ]] && break; sleep .1; done
  [[ $rc != 2 ]] || return 1
  if [[ $rc == 0 ]]; then
    event emergency-kill "$(basename "$file")"; kill -KILL "$pid"
    for ((i=0;i<20;i++)); do rc=0; life "$file" || rc=$?; [[ $rc != 0 ]] && break; sleep .1; done
  fi
  [[ $rc == 1 ]]
}
# Attribute commands after a fixture edit to the controller that actually ran.
event controller-invocation "$op sha256=$(shasum -a 256 "$here/lab.sh" | awk '{print $1}')"
case "$op" in
create)
  armed=true
  printf '%s\n' "$resolved" > "$work/cli.json"
  cli="$(jq -r .cli "$work/cli.json")"
  jq -n '{defaultProvider:"lifecycle",defaultModel:"offline",defaultThinkingLevel:"off",defaultProjectTrust:"never",compaction:{enabled:false},retry:{enabled:false},enableInstallTelemetry:false,fullscreenCopyOnSelect:false}' > "$work/agent/settings.json"
  printf '{}\n' > "$work/agent/auth.json"
  "${clean_env[@]}" "$node" "$cli" --version > "$work/version.txt" 2>&1
  shasum -a 256 "$cli" "$here/"* "$repo/pi/test-lifecycle.sh" "$repo/pi/test-lifecycle-lab.sh" "$repo/pi/test-lifecycle-ownership.sh" > "$work/hashes.txt"
  # The bundle entry delegates to sibling runtime files; include those, without assuming their names.
  find "$(dirname "$cli")" -type f -name '*.js' -exec shasum -a 256 {} + >> "$work/hashes.txt"
  while IFS= read -r extension; do shasum -a 256 "$extension" >> "$work/hashes.txt"; done < <(jq -r '.extensions[]?' "$work/cli.json")
  "${clean_env[@]}" "$node" "$here/provider.mjs" "$work" > "$work/provider.log" 2>&1 &
  remember provider "$!"
  for ((i=0;i<100;i++)); do [[ -s "$work/port" ]] && break; sleep .1; done
  [[ -s "$work/port" ]] || fail "Provider startup failed; cleanup $id"
  jq -n --arg url "http://127.0.0.1:$(< "$work/port")/v1" '{providers:{lifecycle:{baseUrl:$url,api:"openai-completions",apiKey:"synthetic-only",models:[{id:"offline",contextWindow:128000,maxTokens:1024}]}}}' > "$work/agent/models.json"
  # The first attached client sees a placeholder, not a racing Pi startup.
  printf '#!/usr/bin/env bash\nexec %q -e %q %q\n' "$node" 'setInterval(() => {}, 1000)' "$work" > "$work/placeholder.sh"
  launch_rc=0
  "${clean_env[@]}" "$tmux_bin" -S "$socket" -f /dev/null new-session -d -P -F '#{pid} #{pane_pid}' -s lab -n away -x 140 -y 40 "$bash_bin '$work/placeholder.sh'" > "$work/server-receipt" || launch_rc=$?
  read -r server_pid placeholder_pid < "$work/server-receipt" || true
  if [[ ${server_pid:-} =~ ^[0-9]+$ ]]; then remember server "$server_pid"; fi
  if [[ ${placeholder_pid:-} =~ ^[0-9]+$ ]]; then
    for ((i=0;i<50;i++)); do ident="$(identity "$placeholder_pid" || true)"; [[ "$ident" == *"$node"* ]] && break; sleep .1; done
    remember placeholder "$placeholder_pid"
  fi
  [[ $launch_rc == 0 && -f "$work/actors/server.json" ]] || fail 'Private server launch failed'
  tm set-option -g default-shell "$bash_bin"
  tm set-option -g default-command "$bash_bin --noprofile --norc"
  tm set-option -g exit-empty off
  tm set-option -g remain-on-exit on
  event created
  jq -n --arg id "$id" --arg cwd "$work/cwd" --arg evidence "$work" '{id:$id,cwd:$cwd,evidence:$evidence}'
  ;;
attach)
  [[ $# == 1 ]] || fail 'attach needs CLIENT'; valid "$1"; name="$1"
  [[ ! -d "$work/clients/$name" ]] || fail 'Use a fresh client name'
  server; mkdir "$work/clients/$name"
  armed=true
  "${clean_env[@]}" "$python" "$here/terminal_client.py" "$work" "$name" "$tmux_bin" > "$work/clients/$name/helper.log" 2>&1 &
  remember "helper-$name" "$!"
  for ((i=0;i<100;i++)); do [[ -s "$work/clients/$name/ready.json" ]] && break; sleep .1; done
  # macOS python3 may exec its framework interpreter before publishing ready.
  helper_pid="$(jq -r .pid "$work/actors/helper-$name.json")"
  remember "helper-$name" "$helper_pid"
  client "$name"; remember "client-$name" "$client_pid"
  for ((i=0;i<100;i++)); do tty="$(attached_tty)"; [[ -n "$tty" ]] && break; sleep .1; done
  [[ -n "$tty" ]] || fail 'Client attachment deadline'
  event attached "$name" ;;
reconnect)
  [[ $# == 1 ]] || fail 'reconnect needs INSTANCE'; conversation "$1"
  life "$work/actors/pi-$1.json" || fail 'Instance is not alive with its recorded identity'
  tm select-window -t "$pane"; event reconnected "$1" ;;
open|fresh)
  if [[ $op == open ]]; then [[ $# == 1 ]] || fail 'open needs CONVERSATION'; name="$1";
  else [[ $# == 2 ]] || fail 'fresh needs CONVERSATION INSTANCE'; name="$2"; fi
  valid "$1"; valid "$name"; history="$1"
  [[ ! -f "$work/conversations/$name.json" ]] || fail 'Instance name already used; reconnect or choose a fresh instance name'
  [[ -n "$(tm list-clients -F '#{client_pid}')" ]] || fail 'Attach a client first'
  cli="$(jq -r .cli "$work/cli.json")"
  mkdir -p "$work/instances"
  instance_cwd="$(mktemp -d "$work/instances/$name.XXXXXXXX")"
  printf '#!/usr/bin/env bash\ncd %q\nexec %q %q --no-extensions --no-mcp --no-context-files --no-skills --no-prompt-templates --no-tools --session %q --name %q' "$instance_cwd" "$node" "$cli" "$work/histories/$history.jsonl" "$history" > "$work/launch-$name.sh"
  while IFS= read -r extension; do printf ' --extension %q' "$extension" >> "$work/launch-$name.sh"; done < <(jq -r '.extensions[]?' "$work/cli.json")
  printf '\n' >> "$work/launch-$name.sh"
  armed=true; launch_rc=0
  tm new-window -P -F '#{pane_id} #{pane_pid}' -t lab -n "$name" "$bash_bin '$work/launch-$name.sh'" > "$work/open-$name-receipt" || launch_rc=$?
  read -r pane pid < "$work/open-$name-receipt" || true
  [[ ${pid:-} =~ ^[0-9]+$ && ${pane:-} =~ ^%[0-9]+$ ]] || fail 'Window launch returned no actor receipt'
  jq -n --arg pane "$pane" --arg history "$history" '{pane:$pane,history:$history}' > "$work/conversations/$name.json"
  for ((i=0;i<100;i++)); do
    actual_cwd="$(process_cwd "$pid" || true)"
    [[ "$actual_cwd" == "$instance_cwd" || "$actual_cwd" == "/private$instance_cwd" ]] && break
    presence=0; "$node" "$here/process-presence.mjs" "$pid" || presence=$?
    [[ $presence == 1 ]] && break
    [[ $presence != 2 ]] || fail 'Launch process observation ambiguous'
    sleep .1
  done
  remember "pi-$name" "$pid" "$instance_cwd"
  [[ $launch_rc == 0 ]] || fail 'Window launch reported failure'
  rc=0; life "$work/actors/pi-$name.json" || rc=$?
  [[ $rc != 2 ]] || fail 'Pi launch identity could not be verified'
  # A candidate may reject opening or exit normally. This is a product result,
  # not permission to tear down other live instances in this lab.
  if [[ $rc == 1 ]]; then
    event instance-exited "$name exit=$(tm display-message -p -t "$pane" '#{pane_dead_status}')"
  else event opened "$name"; fi ;;
screen)
  [[ $# == 1 ]] || fail 'screen needs CONVERSATION'; conversation "$1"
  tm capture-pane -p -t "$pane" ;;
type|key)
  [[ $# == 2 ]] || fail 'type/key needs CONVERSATION and INPUT'; conversation "$1"
  if [[ $op == type ]]; then
    [[ "$2" != *'!'* && "$2" != *'@'* ]] || fail 'Shell and file expansion input excluded'
    if printf '%s' "$2" | LC_ALL=C grep -q '[[:cntrl:]]'; then fail 'Control bytes excluded'; fi
    if [[ "$2" == *'/'* ]]; then
      case "$2" in /quit|/exit|/session|/resume|/new|/reload|/help|/hotkeys) ;; *) fail 'Only documented app commands are allowed';; esac
    fi
  fi
  event "$op" "$1: $2"
  if [[ $op == type ]]; then tm send-keys -t "$pane" -l -- "$2";
  else case "$2" in Enter|Escape|C-c|C-d|C-r|Up|Down|Tab) tm send-keys -t "$pane" "$2";; *) fail 'Unsupported key';; esac; fi ;;
switch)
  [[ $# == 2 ]] || fail 'switch needs CLIENT and DESTINATION'; client "$1"; tty="$(attached_tty)"; [[ -n "$tty" ]] || fail 'Client not attached'
  if [[ $2 == away ]]; then target=lab:away; else conversation "$2"; target="$pane"; fi
  tm switch-client -c "$tty" -t "$target"; event switched "$1: $2" ;;
resize)
  [[ $# == 3 ]] || fail 'resize needs CLIENT COLS ROWS'; client "$1"
  [[ $2 =~ ^[0-9]{2,3}$ && $3 =~ ^[0-9]{2,3}$ ]] || fail 'Invalid terminal size'
  (( 10#$2 >= 40 && 10#$2 <= 300 && 10#$3 >= 10 && 10#$3 <= 100 )) || fail 'Terminal size out of range'
  jq -n --argjson cols "$2" --argjson rows "$3" '{cols:$cols,rows:$rows}' > "$work/clients/$1/resize.tmp"
  mv "$work/clients/$1/resize.tmp" "$work/clients/$1/resize.json"; event resized "$*" ;;
detach|close)
  [[ $# == 1 ]] || fail 'detach/close needs CLIENT'; client "$1"
  if [[ $op == detach ]]; then tty="$(attached_tty)"; [[ -n "$tty" ]] || fail 'Client not attached'; tm detach-client -t "$tty";
  else touch "$work/clients/$1/close"; fi
  event "$op" "$1" ;;
saved)
  [[ $# == 1 ]] || fail 'saved needs CONVERSATION'; conversation "$1"
  history="$(jq -r .history "$work/conversations/$1.json")"; valid "$history"
  if [[ -f "$work/histories/$history.jsonl" ]]; then
    jq -r 'select(.type=="message")|.message|select(.role=="user" or .role=="assistant")|.role + ": " + ([.content[]?|select(.type=="text")|.text]|join("\n"))' "$work/histories/$history.jsonl"
  fi ;;
status)
  [[ $# == 0 ]] || fail 'status takes only ID'
  actors='[]'; conversations='{}'
  for file in "$work/actors/"*.json; do
    [[ -f "$file" ]] || continue
    rc=0; life "$file" || rc=$?
    [[ $rc != 2 ]] || fail "Actor identity changed or could not be verified: ${file##*/}"
    alive=false; [[ $rc != 0 ]] || alive=true
    role="$(jq -r .role "$file")"
    actors="$(jq -c --arg role "$role" --argjson alive "$alive" '. + [{role:$role,alive:$alive}]' <<< "$actors")"
    if [[ $role == pi-* ]]; then conversations="$(jq -c --arg name "${role#pi-}" --argjson alive "$alive" '. + {($name):{alive:$alive}}' <<< "$conversations")"; fi
  done
  count=0
  if life "$work/actors/server.json"; then count="$(tm list-clients -F '#{client_pid}' | awk 'NF {n++} END {print n+0}')"; fi
  receipts="$(jq -s '[.[]|select(.event=="response")]|length' "$work/events.jsonl")"
  streams="$(jq -s '[.[]|select(.event|startswith("stream-"))]|group_by(.requestId)|map({id:.[0].requestId,state:(last.event|ltrimstr("stream-")),chunks:([.[]|.chunks // .chunk // 0]|max)})' "$work/events.jsonl")"
  jq -n --argjson actors "$actors" --argjson conversations "$conversations" --argjson count "$count" --argjson receipts "$receipts" --argjson streams "$streams" '{actors:$actors,conversations:$conversations,attachedClients:$count,receipts:$receipts,streams:$streams}' ;;
cleanup)
  [[ $# == 0 ]] || fail 'cleanup takes only ID'
  event cleanup-start
  ok=true
  # Preflight the entire inventory before any signal, including server teardown
  # that could indirectly terminate a child whose identity could not be verified.
  for file in "$work/actors/"*.json; do
    [[ -f "$file" ]] || continue
    rc=0; life "$file" || rc=$?
    if [[ $rc == 2 ]]; then event cleanup-ambiguity "$file"; ok=false; fi
  done
  if [[ $ok == false ]]; then
    event cleanup-finished false
    jq -n '{success:false}' | tee "$work/cleanup.json"
    fail 'Cleanup preflight ambiguous; no signals sent'
  fi
  # Pi first, then private clients/helpers/provider; server last. No global signals.
  for pattern in 'pi-*.json' 'client-*.json' 'helper-*.json' 'provider.json' 'placeholder.json' 'server.json'; do
    for file in "$work/actors/"$pattern; do
      [[ -f "$file" ]] || continue
      if ! stop_actor "$file"; then ok=false; break 2; fi
    done
  done
  for file in "$work/actors/"*.json; do
    [[ -f "$file" ]] || continue
    rc=0; life "$file" || rc=$?; [[ $rc == 1 ]] || ok=false
  done
  event cleanup-finished "$ok"
  jq -n --argjson success "$ok" '{success:$success}' | tee "$work/cleanup.json"
  [[ $ok == true ]] || fail 'Cleanup incomplete; inspect retained evidence' ;;
*) fail 'Unknown operation';;
esac
