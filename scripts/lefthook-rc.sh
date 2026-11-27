# Sourced by every lefthook git hook (the `rc:` key in lefthook.yml) before it
# looks for lefthook or runs a job.
#
# Git hooks inherit whatever PATH the caller had. GUI git clients, editor
# integrations and agent shells often start with only /usr/bin:/bin, so node
# and pnpm (installed via nvm, Volta or Homebrew) are missing and every hook
# dies with `env: node: No such file or directory` or exit 127. This prepends
# the usual install locations, but only when pnpm isn't already reachable, and
# only the directories that exist. POSIX sh — no bash-isms.

if ! command -v pnpm >/dev/null 2>&1; then
  # Each entry is prepended, so the list runs lowest priority first: the
  # user-level shims (~/.local/bin) end up winning, as they do in ~/.zshenv.
  for _lefthook_dir in \
    /usr/local/bin \
    /opt/homebrew/bin \
    "$HOME/.nvm/versions/node/__nvm_default__/bin" \
    "$HOME/.local/share/pnpm" \
    "$HOME/Library/pnpm" \
    "$HOME/.volta/bin" \
    "$HOME/.local/bin"; do
    # nvm's default Node (and the pnpm installed under it).
    if [ "$_lefthook_dir" = "$HOME/.nvm/versions/node/__nvm_default__/bin" ]; then
      [ -r "$HOME/.nvm/alias/default" ] || continue
      _lefthook_ver=$(cat "$HOME/.nvm/alias/default")
      _lefthook_dir="$HOME/.nvm/versions/node/v${_lefthook_ver#v}/bin"
    fi
    if [ -d "$_lefthook_dir" ]; then
      case ":$PATH:" in
        *":$_lefthook_dir:"*) ;;
        *) PATH="$_lefthook_dir:$PATH" ;;
      esac
    fi
  done

  unset _lefthook_dir _lefthook_ver
  export PATH
fi

# This repo pins pnpm 9 in package.json; corepack would otherwise stop and ask before
# downloading it, which hangs a non-interactive hook.
COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT
