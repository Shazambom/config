#!/usr/bin/env bash
# Preserve Pi's argv. Only an offline, extension-disabled RPC fork drops our
# extension flags: that helper copies history without loading either feature.
pi_prepare_launch_args() {
  pi_launch_args=("$@")
  pi_launch_t3=false
  pi_launch_mode=''
  local value='' owned_value='' arg index=0 offline=false fork=false
  local no_extensions=false no_tools=false explicit_extension=false inspection=false
  local positional=false ended=false valid_owned_flags=true
  local remove=()
  for arg; do
    if [[ "$ended" == true ]]; then positional=true; index=$((index+1)); continue; fi
    if [[ -n "$value" ]]; then
      case "$value" in
        --mode) pi_launch_mode="$arg" ;;
        --fork) fork=true ;;
        --extension|-e) explicit_extension=true ;;
      esac
      value=''; index=$((index+1)); continue
    fi
    # Pi's unknown long flags consume a following non-option value. Preserve
    # that value normally, and remove it with its flag in the metadata helper.
    if [[ -n "$owned_value" && "$arg" != -* && "$arg" != @* ]]; then
      remove+=("$index")
      [[ "$owned_value" != t3 || "$arg" != false ]] || pi_launch_t3=false
      case "$arg" in true|false) ;; *) valid_owned_flags=false ;; esac
      owned_value=''; index=$((index+1)); continue
    fi
    owned_value=''
    case "$arg" in
      --) ended=true ;;
      --t3|--t3=*)
        case "$arg" in --t3|--t3=true|--t3=false) ;; *) valid_owned_flags=false ;; esac
        pi_launch_t3=true
        [[ "$arg" != --t3=false ]] || pi_launch_t3=false
        remove+=("$index")
        [[ "$arg" != --t3 ]] || owned_value=t3 ;;
      --team|--team=*)
        case "$arg" in --team|--team=true|--team=false) ;; *) valid_owned_flags=false ;; esac
        remove+=("$index")
        [[ "$arg" != --team ]] || owned_value=team ;;
      --offline) offline=true ;;
      --no-extensions|-ne) no_extensions=true ;;
      --no-tools|-nt) no_tools=true ;;
      --help|-h|--version|-v|--list-models) inspection=true ;;
      --mode|--fork|--extension|-e|--provider|--model|--api-key|--system-prompt|--append-system-prompt|--name|-n|--session|--session-id|--session-dir|--models|--tools|-t|--exclude-tools|-xt|--thinking|--export|--skill|--prompt-template|--theme|--use-theme|--tui-mode)
        value="$arg" ;;
      -*) ;;
      *) positional=true ;;
    esac
    index=$((index+1))
  done
  if [[ "$pi_launch_mode" == rpc && "$offline" == true && "$fork" == true &&
        "$no_extensions" == true && "$no_tools" == true &&
        "$explicit_extension" == false && "$positional" == false &&
        "$valid_owned_flags" == true && -z "$value" ]]; then
    if [[ ${#remove[@]} -gt 0 ]]; then
      for index in "${remove[@]}"; do unset 'pi_launch_args[index]'; done
    fi
    pi_launch_t3=false
  elif [[ "$pi_launch_t3" == true && "$pi_launch_mode" != rpc && "$inspection" == false ]]; then
    echo '--t3 requires --mode rpc; ordinary Pi uses its existing tmux delegation.' >&2
    return 1
  fi
}
