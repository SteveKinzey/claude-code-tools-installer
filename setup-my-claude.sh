#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_VERSION="2026-08-26"
BASE_DIR="${HOME}/.setup-my-claude"
CLONE_DIR="${HOME}/.claude/reference-repos"
NODE_RUNTIME_DIR="${BASE_DIR}/node-runtime"
LOG_DIR="${BASE_DIR}/logs"
MANIFEST="${BASE_DIR}/manifest.tsv"
PLUGIN_COMMANDS="${BASE_DIR}/claude-plugin-commands.md"
CLAUDE_BOOTSTRAP_STATE="${BASE_DIR}/claude-code-bootstrap.pid"
CLAUDE_BOOTSTRAP_PID=""
CLAUDE_BOOTSTRAP_OWNED=0
CLAUDE_BOOTSTRAP_LOG=""
CLAUDE_LAUNCHED=0
BOOTSTRAP_ONLY=0
CLAUDE_ONLY=0
COMPLETE=0
FRESH=0
FRESH_CONFIRMED=0
NO_LAUNCH=0
DRY_RUN=0
DEFAULTS=0
ALL=0
YES=0
UNINSTALL=0
SELECTED_RAW=""
CATEGORY_RAW=""

usage() {
  cat <<'USAGE'
setup-my-claude.sh

Safe interactive installer for a curated Claude Code extension stack.

Claude Code is started in a background Terminal window when it is already installed.
If it is missing, the official Claude Code installer starts in the background while you make selections.

Usage:
  ./setup-my-claude.sh                 Interactive selection
  ./setup-my-claude.sh --defaults      Install curated defaults
  ./setup-my-claude.sh --dry-run       Show what would happen
  ./setup-my-claude.sh --item id,id    Install specific item ids
  ./setup-my-claude.sh --category cat  Install a category: harness,skills,memory,tools,cost
  ./setup-my-claude.sh --all           Select every installable item
  ./setup-my-claude.sh --bootstrap-only Start or open Claude Code, then exit
  ./setup-my-claude.sh --claude-only    Install Claude Code only and wait until it is ready
  ./setup-my-claude.sh --complete      Install prerequisites, Claude Code, and curated defaults
  ./setup-my-claude.sh --fresh         Remove Claude Code and its local data before setup (requires --complete)
  ./setup-my-claude.sh --no-launch     Do not open a Terminal window after preparation
  ./setup-my-claude.sh --uninstall     Roll back items recorded in the manifest

Options can be combined, for example:
  ./setup-my-claude.sh --defaults --dry-run
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --defaults) DEFAULTS=1 ;;
    --all) ALL=1 ;;
    --bootstrap-only) BOOTSTRAP_ONLY=1 ;;
    --claude-only) CLAUDE_ONLY=1 ;;
    --complete) COMPLETE=1 ;;
    --fresh) FRESH=1 ;;
    --fresh-confirmed) FRESH_CONFIRMED=1 ;;
    --no-launch) NO_LAUNCH=1 ;;
    --yes|-y) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --item|--items) shift; SELECTED_RAW="${1:-}" ;;
    --category|--categories) shift; CATEGORY_RAW="${1:-}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

if [[ "$FRESH" -eq 1 && "$COMPLETE" -ne 1 ]]; then
  echo "--fresh must be used with --complete." >&2
  exit 2
fi
if [[ "$FRESH" -eq 1 && "$FRESH_CONFIRMED" -ne 1 ]]; then
  echo "--fresh is destructive and requires confirmation from the desktop app." >&2
  exit 2
fi
if [[ "$COMPLETE" -eq 1 ]]; then
  DEFAULTS=1
  YES=1
  NO_LAUNCH=0
fi

LOG_FILE=""
if [[ "$DRY_RUN" -eq 0 ]]; then
  mkdir -p "$BASE_DIR" "$LOG_DIR" "$CLONE_DIR"
  LOG_FILE="${LOG_DIR}/run-$(date +%Y%m%d-%H%M%S).log"
  touch "$MANIFEST" "$LOG_FILE" "$PLUGIN_COMMANDS"
fi

log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  printf '%s\n' "$line"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    printf '%s\n' "$line" >> "$LOG_FILE"
  fi
}

run_cmd() {
  log "+ $*"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  "$@"
}

record_manifest() {
  local kind="$1" target="$2" extra="$3" item="$4"
  [[ "$DRY_RUN" -eq 1 ]] && return 0
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$kind" "$target" "$extra" "$item" >> "$MANIFEST"
}

append_plugin_command() {
  local title="$1" commands="$2" source="$3"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would queue Claude Code plugin commands for $title"
    return 0
  fi
  {
    printf '\n## %s\n\n' "$title"
    printf 'Source: %s\n\n' "$source"
    printf 'Run inside Claude Code:\n\n```text\n%s\n```\n' "$commands"
  } >> "$PLUGIN_COMMANDS"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd" >&2
    return 1
  fi
}

refresh_claude_path() {
  local native_bin="${HOME}/.local/bin"
  if [[ -d "$native_bin" && ":${PATH}:" != *":${native_bin}:"* ]]; then
    export PATH="${native_bin}:${PATH}"
  fi
  if [[ -d "${NODE_RUNTIME_DIR}/bin" && ":${PATH}:" != *":${NODE_RUNTIME_DIR}/bin:"* ]]; then
    export PATH="${NODE_RUNTIME_DIR}/bin:${PATH}"
  fi
}

ensure_node_runtime() {
  local arch package checksum_file archive extract_dir expected actual
  refresh_claude_path
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && command -v npx >/dev/null 2>&1; then
    log "Node.js toolchain detected: $(node --version 2>/dev/null || echo unknown)"
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would download the official Node.js 22 LTS runtime into $NODE_RUNTIME_DIR"
    return 0
  fi
  require_cmd curl
  require_cmd tar
  require_cmd shasum
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) echo "Unsupported macOS processor architecture for managed Node.js: $(uname -m)" >&2; return 1 ;;
  esac
  extract_dir="$(mktemp -d "${BASE_DIR}/node-download.XXXXXX")"
  checksum_file="${extract_dir}/SHASUMS256.txt"
  curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$checksum_file"
  package="$(awk -v suffix="darwin-${arch}.tar.gz" '$2 ~ suffix {print $2; exit}' "$checksum_file")"
  if [[ -z "$package" || ! "$package" =~ ^node-v[0-9]+\.[0-9]+\.[0-9]+-darwin-(arm64|x64)\.tar\.gz$ ]]; then
    echo "Could not determine a supported Node.js 22 LTS download for this Mac." >&2
    return 1
  fi
  expected="$(awk -v file="$package" '$2 == file {print $1; exit}' "$checksum_file")"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/${package}" -o "${extract_dir}/${package}"
  actual="$(shasum -a 256 "${extract_dir}/${package}" | awk '{print $1}')"
  if [[ "$expected" != "$actual" ]]; then
    echo "Node.js download checksum verification failed. Nothing was installed." >&2
    return 1
  fi
  tar -xzf "${extract_dir}/${package}" -C "$extract_dir"
  rm -rf "$NODE_RUNTIME_DIR"
  mv "${extract_dir}/${package%.tar.gz}" "$NODE_RUNTIME_DIR"
  rm -rf "$extract_dir"
  refresh_claude_path
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
    echo "Managed Node.js installation completed, but its commands are unavailable." >&2
    return 1
  fi
  record_manifest "managed-runtime" "$NODE_RUNTIME_DIR" "Official Node.js 22 LTS runtime for Claude Code Tools Installer." "node-runtime"
  log "Installed managed Node.js runtime: $(node --version)"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would request Apple's Command Line Tools so Git is available"
    return 0
  fi
  if command -v xcode-select >/dev/null 2>&1; then
    xcode-select --install >/dev/null 2>&1 || true
    echo "macOS needs Apple's Command Line Tools to provide Git. Approve the macOS prompt, wait for it to finish, then click Complete setup again." >&2
    return 1
  fi
  echo "Git is required but macOS could not start the Command Line Tools installer." >&2
  return 1
}

fresh_claude_code() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would remove native Claude Code files, legacy npm files, settings, session history, and local tool configuration"
    return 0
  fi
  log "Removing Claude Code native installation and local configuration for a clean setup"
  rm -f "${HOME}/.local/bin/claude"
  rm -rf "${HOME}/.local/share/claude" "${HOME}/.claude/local" "${HOME}/.claude" "${HOME}/.claude.json" "$CLONE_DIR" "$NODE_RUNTIME_DIR"
  if command -v npm >/dev/null 2>&1 && npm list -g @anthropic-ai/claude-code >/dev/null 2>&1; then
    npm uninstall -g @anthropic-ai/claude-code || log "The global npm Claude Code package could not be removed automatically."
  fi
  if command -v brew >/dev/null 2>&1; then
    for cask in claude-code claude-code@latest; do
      if brew list --cask "$cask" >/dev/null 2>&1; then
        brew uninstall --cask "$cask"
      fi
    done
  fi
  : > "$MANIFEST"
  : > "$PLUGIN_COMMANDS"
  log "Start-fresh cleanup completed. The installer will now provision a new Claude Code setup."
}

claude_path() {
  refresh_claude_path
  command -v claude 2>/dev/null || true
}

launch_claude_code() {
  local claude_bin="$1"
  local launch_file="${BASE_DIR}/launch-claude-code.sh"

  [[ "$CLAUDE_LAUNCHED" -eq 1 ]] && return 0
  if [[ "$NO_LAUNCH" -eq 1 ]]; then
    log "Claude Code is ready. Terminal launch was skipped because the desktop app will guide the next step."
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would open Claude Code in a background Terminal window from $PWD"
    return 0
  fi

  cat > "$launch_file" <<EOF
#!/usr/bin/env bash
cd -- "$PWD"
exec "$claude_bin"
EOF
  chmod 700 "$launch_file"

  if open -g -a Terminal "$launch_file" >/dev/null 2>&1; then
    CLAUDE_LAUNCHED=1
    log "Opened Claude Code in a background Terminal window from $PWD"
  else
    log "Claude Code is installed, but Terminal could not be opened automatically. Run: cd '$PWD' && '$claude_bin'"
  fi
}

reuse_active_claude_bootstrap() {
  local recorded_pid
  if [[ ! -s "$CLAUDE_BOOTSTRAP_STATE" ]]; then
    return 1
  fi
  recorded_pid="$(cat "$CLAUDE_BOOTSTRAP_STATE" 2>/dev/null || true)"
  if [[ "$recorded_pid" =~ ^[0-9]+$ ]] && kill -0 "$recorded_pid" 2>/dev/null; then
    CLAUDE_BOOTSTRAP_PID="$recorded_pid"
    log "Reusing existing Claude Code bootstrap (pid $CLAUDE_BOOTSTRAP_PID)."
    return 0
  fi
  rm -f "$CLAUDE_BOOTSTRAP_STATE"
  return 1
}

start_claude_bootstrap() {
  local claude_bin
  refresh_claude_path
  claude_bin="$(claude_path)"
  if [[ -n "$claude_bin" ]]; then
    log "Existing Claude Code detected: $claude_bin"
    if [[ "$COMPLETE" -eq 1 ]]; then
      log "Complete setup will open Claude Code after the recommended tools are ready."
    else
      launch_claude_code "$claude_bin"
    fi
    return 0
  fi
  if reuse_active_claude_bootstrap; then
    return 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would install Claude Code with the official native installer in the background"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    log "Claude Code is missing and curl is unavailable, so the official installer cannot start."
    return 1
  fi

  CLAUDE_BOOTSTRAP_LOG="${LOG_DIR}/claude-code-bootstrap-$(date +%Y%m%d-%H%M%S).log"
  echo "Claude Code is not installed. Starting Anthropic's official installer in the background while you make selections."
  nohup bash -c 'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash' >"$CLAUDE_BOOTSTRAP_LOG" 2>&1 &
  CLAUDE_BOOTSTRAP_PID=$!
  CLAUDE_BOOTSTRAP_OWNED=1
  printf '%s\n' "$CLAUDE_BOOTSTRAP_PID" > "$CLAUDE_BOOTSTRAP_STATE"
  log "Started Claude Code bootstrap in background (pid $CLAUDE_BOOTSTRAP_PID). Log: $CLAUDE_BOOTSTRAP_LOG"
}

ensure_claude_ready() {
  local claude_bin
  refresh_claude_path

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: Claude Code bootstrap would complete before selected tools are installed"
    return 0
  fi

  if [[ -n "$CLAUDE_BOOTSTRAP_PID" ]]; then
    echo "Waiting for Claude Code to finish installing before applying selected tools..."
    if [[ "$CLAUDE_BOOTSTRAP_OWNED" -eq 1 ]]; then
      if ! wait "$CLAUDE_BOOTSTRAP_PID"; then
        rm -f "$CLAUDE_BOOTSTRAP_STATE"
        echo "Claude Code installation failed. Review: ${CLAUDE_BOOTSTRAP_LOG:-the latest claude-code-bootstrap log in $LOG_DIR}" >&2
        return 1
      fi
    else
      while kill -0 "$CLAUDE_BOOTSTRAP_PID" 2>/dev/null; do
        sleep 1
      done
    fi
    rm -f "$CLAUDE_BOOTSTRAP_STATE"
    claude_bin="$(claude_path)"
    if [[ -z "$claude_bin" ]]; then
      echo "Claude Code finished installing but is not available in this shell. Restart Terminal, then rerun the installer. Bootstrap log: $CLAUDE_BOOTSTRAP_LOG" >&2
      return 1
    fi
    record_manifest "manual-review" "$claude_bin" "Installed by Claude Code's official native installer; manage updates and removal with Claude Code's documented commands." "claude-code"
    log "Claude Code bootstrap completed: $claude_bin"
    if [[ "$COMPLETE" -eq 1 ]]; then
      log "Complete setup will open Claude Code after the recommended tools are ready."
    else
      launch_claude_code "$claude_bin"
    fi
    return 0
  fi

  claude_bin="$(claude_path)"
  if [[ -n "$claude_bin" ]]; then
    if [[ "$COMPLETE" -eq 0 ]]; then
      launch_claude_code "$claude_bin"
    fi
    return 0
  fi

  echo "Claude Code is required to finish this setup, but the bootstrap did not start." >&2
  return 1
}

check_dependencies() {
  local missing=0
  for cmd in node npm npx git; do
    if ! require_cmd "$cmd"; then
      missing=1
    fi
  done
  if [[ "$missing" -eq 1 ]]; then
    if [[ "$COMPLETE" -eq 1 && "$DRY_RUN" -eq 1 ]]; then
      log "Dry run: Complete setup would make the missing tool dependencies available before installing curated tools"
      return 0
    fi
    echo
    echo "Complete setup could not prepare all required dependencies. Node.js (node, npm, npx) and Git are required."
    exit 1
  fi
  log "Tool dependency versions:"
  log "node: $(node --version 2>/dev/null || echo unknown)"
  log "npm: $(npm --version 2>/dev/null || echo unknown)"
  log "git: $(git --version 2>/dev/null || echo unknown)"
}

source_version() {
  local source="$1"
  if [[ "$source" =~ ^https://github.com/([^/]+)/([^/]+) ]]; then
    git ls-remote "$source" HEAD 2>/dev/null | awk '{print $1}' || true
  elif [[ "$source" =~ ^npm:(.+)$ ]]; then
    npm view "${BASH_REMATCH[1]}" version 2>/dev/null || true
  fi
}

already_path() {
  [[ -e "$1" ]]
}

mcp_exists() {
  local name="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would check whether MCP server '$name' already exists; no Claude Code command will run"
    return 1
  fi
  claude mcp list 2>/dev/null | awk '{print $1}' | grep -Fxq "$name"
}

clone_or_update() {
  local repo="$1" dest="$2" item="$3"
  if already_path "$dest/.git"; then
    log "Existing git checkout detected: $dest"
    run_cmd git -C "$dest" pull --ff-only
  elif already_path "$dest"; then
    log "Existing non-git path detected, skipping clone: $dest"
  else
    run_cmd git clone --depth 1 "$repo" "$dest"
    record_manifest "path" "$dest" "" "$item"
  fi
}

install_skill() {
  local repo="$1" skill="$2" item="$3"
  local dest="${HOME}/.claude/skills/${skill}"
  if already_path "$dest"; then
    log "Existing skill detected: $dest"
    return 0
  fi
  run_cmd npx -y skills add "$repo" --skill "$skill" --agent claude-code
  record_manifest "skill" "$dest" "" "$item"
}

install_npm_global() {
  local package="$1" bin="$2" item="$3"
  if command -v "$bin" >/dev/null 2>&1; then
    log "Existing command detected: $bin"
    return 0
  fi
  run_cmd npm install -g "$package"
  record_manifest "npm-global" "$package" "$bin" "$item"
}

install_mcp() {
  local name="$1"; shift
  local item="$1"; shift
  if mcp_exists "$name"; then
    log "Existing MCP server detected: $name"
    return 0
  fi
  run_cmd claude mcp add "$name" "$@"
  record_manifest "mcp" "$name" "" "$item"
}

install_mcp_after_dashdash() {
  local name="$1"; shift
  local item="$1"; shift
  if mcp_exists "$name"; then
    log "Existing MCP server detected: $name"
    return 0
  fi
  run_cmd claude mcp add "$name" -- "$@"
  record_manifest "mcp" "$name" "" "$item"
}

install_item() {
  local id="$1"
  local version=""
  case "$id" in
    learn-claude-code)
      version="$(source_version https://github.com/shareAI-lab/learn-claude-code)"
      log "Source learn-claude-code HEAD: ${version:-unknown}"
      clone_or_update https://github.com/shareAI-lab/learn-claude-code "${CLONE_DIR}/learn-claude-code" "$id"
      ;;
    karpathy-skills)
      version="$(source_version https://github.com/multica-ai/andrej-karpathy-skills)"
      log "Source karpathy-skills HEAD: ${version:-unknown}"
      clone_or_update https://github.com/multica-ai/andrej-karpathy-skills "${CLONE_DIR}/andrej-karpathy-skills" "$id"
      ;;
    superpowers)
      append_plugin_command "Superpowers" "/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
/reload-plugins" "https://github.com/obra/superpowers and https://github.com/obra/superpowers-marketplace"
      log "Queued Superpowers Claude Code plugin commands in $PLUGIN_COMMANDS"
      ;;
    ponytail)
      install_skill https://github.com/DietrichGebert/ponytail ponytail "$id"
      ;;
    gstack)
      local dest="${HOME}/.claude/skills/gstack"
      version="$(source_version https://github.com/garrytan/gstack)"
      log "Source gstack HEAD: ${version:-unknown}"
      if already_path "$dest/.git"; then
        log "Existing gstack checkout detected: $dest"
      else
        run_cmd git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git "$dest"
        record_manifest "path" "$dest" "" "$id"
      fi
      if [[ -x "$dest/setup" ]]; then
        run_cmd bash -lc "cd '$dest' && ./setup"
      else
        log "gstack setup script not found or not executable at $dest/setup"
      fi
      ;;
    ecc)
      append_plugin_command "ECC" "/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
/reload-plugins" "https://github.com/affaan-m/ECC"
      log "Queued ECC plugin commands in $PLUGIN_COMMANDS"
      ;;
    taste-skill)
      install_skill https://github.com/Leonxlnx/taste-skill design-taste-frontend "$id"
      ;;
    anthropic-skills)
      append_plugin_command "Anthropic Agent Skills" "/plugin marketplace add anthropics/skills
/plugin
# Browse anthropic-agent-skills, then install document-skills or example-skills as needed." "https://github.com/anthropics/skills"
      log "Queued Anthropic skills marketplace commands in $PLUGIN_COMMANDS"
      ;;
    wshobson-agents)
      append_plugin_command "wshobson agents" "/plugin marketplace add https://github.com/wshobson/agents
/plugin install claude-code-essentials
/reload-plugins" "https://github.com/wshobson/agents"
      log "Queued wshobson agents plugin commands in $PLUGIN_COMMANDS"
      ;;
    claude-plugins-official)
      append_plugin_command "Anthropic official plugin marketplace" "/plugin
# Browse Discover / claude-plugins-official and install only the plugins you need.
# Direct syntax for known plugin names:
# /plugin install {plugin-name}@claude-plugins-official" "https://github.com/anthropics/claude-plugins-official"
      log "Queued official plugin marketplace note in $PLUGIN_COMMANDS"
      ;;
    frontend-design)
      append_plugin_command "Frontend Design" "/plugin install frontend-design@claude-plugins-official
/reload-plugins" "https://claude.com/plugins/frontend-design"
      log "Queued Frontend Design plugin command in $PLUGIN_COMMANDS"
      ;;
    code-review)
      append_plugin_command "Code Review" "/plugin install code-review@claude-plugins-official
/reload-plugins" "https://claude.com/plugins/code-review"
      log "Queued Code Review plugin command in $PLUGIN_COMMANDS"
      ;;
    context7)
      append_plugin_command "Context7" "/plugin install context7@claude-plugins-official
/reload-plugins" "https://claude.com/plugins/context7"
      log "Queued Context7 plugin command in $PLUGIN_COMMANDS"
      ;;
    skill-creator)
      append_plugin_command "Skill Creator" "/plugin install skill-creator@claude-plugins-official
/reload-plugins" "https://claude.com/plugins/skill-creator"
      log "Queued Skill Creator plugin command in $PLUGIN_COMMANDS"
      ;;
    ui-ux-pro-max)
      version="$(source_version https://github.com/nextlevelbuilders/ui-ux-pro-max)"
      log "Source ui-ux-pro-max HEAD: ${version:-unknown}"
      clone_or_update https://github.com/nextlevelbuilders/ui-ux-pro-max "${CLONE_DIR}/ui-ux-pro-max" "$id"
      ;;
    awesome-claude-skills)
      clone_or_update https://github.com/ComposioHQ/awesome-claude-skills "${CLONE_DIR}/awesome-claude-skills" "$id"
      ;;
    planning-with-files)
      install_skill https://github.com/OthmanAdi/planning-with-files planning-with-files "$id"
      ;;
    claude-mem)
      if [[ -d "${HOME}/.claude-mem" ]]; then
        log "Existing Claude-Mem data directory detected: ~/.claude-mem"
      fi
      run_cmd npx -y claude-mem install
      record_manifest "manual-review" "claude-mem" "Run claude-mem docs uninstall steps if needed; data may live in ~/.claude-mem" "$id"
      ;;
    codegraph)
      install_npm_global @colbymchenry/codegraph codegraph "$id"
      if command -v codegraph >/dev/null 2>&1 && [[ "$DRY_RUN" -eq 0 ]]; then
        log "CodeGraph installed. Run 'codegraph install' and 'codegraph init' inside a project when ready."
      fi
      ;;
    graphify)
      install_skill https://github.com/Graphify-Labs/graphify graphify "$id"
      ;;
    repomix)
      install_npm_global repomix repomix "$id"
      install_mcp_after_dashdash repomix "$id" npx -y repomix --mcp
      ;;
    convex)
      append_plugin_command "Convex for Claude Code" "/plugin install convex@claude-plugins-official
/reload-plugins
# Open a Convex project before using deployment access. The plugin may request a deployment connection when needed." "https://docs.convex.dev/ai/using-claude-code"
      log "Queued the official Convex plugin command in $PLUGIN_COMMANDS"
      ;;
    multica)
      clone_or_update https://github.com/multica-ai/multica "${CLONE_DIR}/multica" "$id"
      log "Multica self-hosting requires Docker and make; not started by this installer."
      ;;
    firecrawl)
      install_npm_global firecrawl-cli firecrawl "$id"
      append_plugin_command "Firecrawl Claude plugin" "/plugin
# Search for firecrawl and install it, then provide FIRECRAWL_API_KEY when the plugin or MCP server asks for it." "https://github.com/firecrawl/firecrawl-claude-plugin"
      log "Firecrawl CLI installed or detected. Plugin command queued in $PLUGIN_COMMANDS"
      ;;
    cc-switch)
      if command -v brew >/dev/null 2>&1; then
        if brew list --cask cc-switch >/dev/null 2>&1; then
          log "Existing Homebrew cask detected: cc-switch"
        else
          run_cmd brew install --cask cc-switch
          record_manifest "brew-cask" "cc-switch" "" "$id"
        fi
      else
        log "Homebrew not found. Download the notarized macOS DMG from https://github.com/farion1231/cc-switch/releases"
      fi
      ;;
    vibe-kanban)
      log "Vibe Kanban repository says the product is sunsetting; install is skipped unless you run npm manually."
      log "Verified npm package: npm install -g vibe-kanban"
      ;;
    github-mcp)
      append_plugin_command "GitHub MCP" "# Credential-sensitive. Prefer Claude's built-in connector or run a scoped PAT setup manually.
# Remote MCP pattern from GitHub docs/issues:
# claude mcp add --transport http github https://api.githubcopilot.com/mcp -H \"Authorization: Bearer YOUR_GITHUB_PAT\"
# Docker local pattern:
# claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=YOUR_TOKEN -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server" "https://github.com/github/github-mcp-server"
      log "Queued GitHub MCP setup notes in $PLUGIN_COMMANDS"
      ;;
    playwright-mcp)
      install_mcp playwright "$id" npx @playwright/mcp@latest
      ;;
    claude-code-router)
      install_npm_global @musistudio/claude-code-router ccr "$id"
      log "Claude Code Router installed or detected. Configure providers before using 'ccr code'."
      ;;
    awesome-mcp-servers)
      clone_or_update https://github.com/punkpeye/awesome-mcp-servers "${CLONE_DIR}/awesome-mcp-servers" "$id"
      ;;
    system-prompts-ai)
      clone_or_update https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools "${CLONE_DIR}/system-prompts-and-models-of-ai-tools" "$id"
      ;;
    best-practice)
      clone_or_update https://github.com/shanraisshan/claude-code-best-practice "${CLONE_DIR}/claude-code-best-practice" "$id"
      ;;
    codex-plugin-cc)
      append_plugin_command "OpenAI Codex in Claude Code" "# This item points to the OpenAI Codex repository/ecosystem.
# Install Codex separately from official OpenAI documentation, then add any Claude plugin only if the repo documents one for your version.
# Repository: https://github.com/openai/codex" "https://github.com/openai/codex"
      log "Queued Codex integration review note in $PLUGIN_COMMANDS"
      ;;
    claude-hud)
      append_plugin_command "Claude HUD" "/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud
/reload-plugins
# After install, run /claude-hud:setup in Claude Code if prompted." "https://github.com/jarrodwatts/claude-hud"
      log "Queued Claude HUD plugin commands in $PLUGIN_COMMANDS"
      ;;
    caveman)
      version="$(source_version https://github.com/JuliusBrussel/caveman)"
      log "Source caveman HEAD: ${version:-unknown}"
      clone_or_update https://github.com/JuliusBrussel/caveman "${CLONE_DIR}/caveman" "$id"
      ;;
    *)
      log "Unknown item id: $id"
      return 1
      ;;
  esac
}

item_table() {
  cat <<'ITEMS'
learn-claude-code|Learn Claude Code|harness|harness/framework|no|clone reference repo
karpathy-skills|Karpathy Skills|harness|memory/context utility|no|clone reference repo
superpowers|Superpowers|harness|plugin/skills framework|yes|queue Claude plugin commands
ponytail|Ponytail|harness|skill|no|npx skills add
gstack|gstack|harness|skill pack/harness|yes|clone to ~/.claude/skills and run setup
ecc|ECC|harness|plugin/harness/security|no|queue Claude plugin commands
taste-skill|taste-skill|skills|skill|yes|npx skills add
anthropic-skills|anthropics/skills|skills|official skills marketplace|yes|queue Claude plugin marketplace commands
wshobson-agents|wshobson/agents|skills|plugin marketplace/subagents|no|queue Claude plugin commands
claude-plugins-official|claude-plugins-official|skills|official plugin marketplace|no|queue browse/install note
frontend-design|Frontend Design|popular|official Claude Code plugin|no|queue official plugin command for review
code-review|Code Review|popular|official Claude Code plugin|no|queue official plugin command for review
context7|Context7|popular|official Claude Code plugin|no|queue official plugin command for review
skill-creator|Skill Creator|popular|official Claude Code plugin|no|queue official plugin command for review
ui-ux-pro-max|ui-ux-pro-max|skills|skill/reference|no|clone reference repo
awesome-claude-skills|awesome-claude-skills|skills|catalog/reference|no|clone reference repo
planning-with-files|planning-with-files|memory|skill|yes|npx skills add
claude-mem|Claude-Mem|memory|memory/context utility|no|npx claude-mem install
codegraph|CodeGraph|memory|CLI/tool|no|npm global install
graphify|Graphify|memory|skill/CLI|no|npx skills add
repomix|Repomix|memory|CLI/MCP server|yes|npm global plus claude mcp add
convex|Convex for Claude Code|tools|official Convex plugin|no|queue plugin command for Convex skills, agents, MCP access, monitors, and rules
multica|Multica|tools|harness/framework|no|clone reference repo only
firecrawl|Firecrawl|tools|plugin/MCP/CLI|no|npm CLI plus plugin command note
cc-switch|CC Switch|tools|desktop CLI/tool|no|Homebrew cask if available
vibe-kanban|Vibe Kanban|tools|desktop/web tool|no|document only; project sunsetting
github-mcp|GitHub MCP|tools|MCP server|no|credential-sensitive command note
playwright-mcp|Playwright MCP|tools|MCP server|yes|claude mcp add
claude-code-router|Claude Code Router|tools|CLI/router|no|npm global install
awesome-mcp-servers|awesome-mcp-servers|tools|catalog/reference|no|clone reference repo
system-prompts-ai|system-prompts-ai|cost|reference/research|no|clone reference repo
best-practice|claude-code-best-practice|cost|reference/workflows|no|clone reference repo
codex-plugin-cc|Codex in Claude|cost|CLI/plugin integration|no|manual review note
claude-hud|Claude HUD|cost|plugin/monitoring|yes|queue Claude plugin commands
caveman|Caveman|cost|cost/token workflow|no|clone reference repo
ITEMS
}

print_items() {
  printf '\nAvailable items:\n'
  item_table | awk -F'|' '{printf "  %-24s %-10s %-26s default:%s\n", $1, $3, $4, $5}'
}

select_items() {
  if [[ "$ALL" -eq 1 ]]; then
    item_table | cut -d'|' -f1
    return
  fi
  if [[ -n "$SELECTED_RAW" ]]; then
    printf '%s\n' "$SELECTED_RAW" | tr ',' '\n' | sed '/^$/d'
    return
  fi
  if [[ -n "$CATEGORY_RAW" ]]; then
    local cats
    cats="$(printf '%s' "$CATEGORY_RAW" | tr ',' '|')"
    item_table | awk -F'|' -v cats="^(${cats})$" '$3 ~ cats {print $1}'
    return
  fi
  if [[ "$DEFAULTS" -eq 1 ]]; then
    item_table | awk -F'|' '$5 == "yes" {print $1}'
    return
  fi

  print_items
  echo
  read -r -p "Use curated defaults? [Y/n] " answer
  answer="${answer:-Y}"
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    item_table | awk -F'|' '$5 == "yes" {print $1}'
    return
  fi
  echo "Enter comma-separated item ids, category names, or 'all':"
  read -r manual
  if [[ "$manual" == "all" ]]; then
    item_table | cut -d'|' -f1
    return
  fi
  local selected=""
  IFS=',' read -r -a parts <<< "$manual"
  for part in "${parts[@]}"; do
    part="$(echo "$part" | xargs)"
    if item_table | awk -F'|' '{print $3}' | grep -Fxq "$part"; then
      selected+=$'\n'"$(item_table | awk -F'|' -v c="$part" '$3 == c {print $1}')"
    else
      selected+=$'\n'"$part"
    fi
  done
  printf '%s\n' "$selected" | sed '/^$/d'
}

uninstall_manifest() {
  if [[ ! -s "$MANIFEST" ]]; then
    echo "No manifest found at $MANIFEST"
    exit 0
  fi
  echo "Rollback uses the manifest at $MANIFEST"
  if [[ "$YES" -ne 1 ]]; then
    read -r -p "Proceed with rollback of recorded paths/MCP/npm/casks? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || exit 0
  fi
  awk '{ lines[NR] = $0 } END { for (i = NR; i >= 1; i--) print lines[i] }' "$MANIFEST" | while IFS=$'\t' read -r ts kind target extra item; do
    case "$kind" in
      path|skill)
        if [[ -e "$target" ]]; then
          run_cmd rm -rf "$target"
        fi
        ;;
      mcp)
        if mcp_exists "$target"; then
          run_cmd claude mcp remove "$target"
        fi
        ;;
      npm-global)
        if npm list -g "$target" >/dev/null 2>&1; then
          run_cmd npm uninstall -g "$target"
        fi
        ;;
      brew-cask)
        if command -v brew >/dev/null 2>&1 && brew list --cask "$target" >/dev/null 2>&1; then
          run_cmd brew uninstall --cask "$target"
        fi
        ;;
      managed-runtime)
        if [[ -e "$target" ]]; then
          run_cmd rm -rf "$target"
        fi
        ;;
      manual-review)
        log "Manual rollback review required for $item: $target $extra"
        ;;
    esac
  done
}

main() {
  log "setup-my-claude.sh version $SCRIPT_VERSION"
  log "Dry run: $DRY_RUN"

  if [[ "$UNINSTALL" -eq 1 ]]; then
    check_dependencies
    uninstall_manifest
    exit 0
  fi

  if [[ "$FRESH" -eq 1 ]]; then
    fresh_claude_code
  fi
  if [[ "$COMPLETE" -eq 1 ]]; then
    ensure_node_runtime
    ensure_git
  fi

  start_claude_bootstrap
  if [[ "$CLAUDE_ONLY" -eq 1 ]]; then
    ensure_claude_ready
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "Dry run: Claude Code installation would run and be checked before this command finishes."
    else
      echo "Claude Code is installed and ready."
    fi
    exit 0
  fi
  if [[ "$BOOTSTRAP_ONLY" -eq 1 ]]; then
    echo "Claude Code preparation has started. You can continue selecting tools in the desktop installer."
    exit 0
  fi

  check_dependencies

  selected=()
  while IFS= read -r selected_item; do
    [[ -n "$selected_item" ]] && selected+=("$selected_item")
  done < <(select_items)
  if [[ "${#selected[@]}" -eq 0 ]]; then
    echo "No items selected."
    exit 0
  fi

  echo
  echo "Selected items:"
  printf '  %s\n' "${selected[@]}"
  echo
  if [[ "$YES" -ne 1 && "$DRY_RUN" -ne 1 ]]; then
    read -r -p "Proceed? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || exit 0
  fi

  ensure_claude_ready

  if [[ "$DRY_RUN" -eq 0 ]]; then
    cat > "$PLUGIN_COMMANDS" <<EOF
# Claude Code plugin commands

Generated by setup-my-claude.sh on $(date).

Some Claude Code plugins must be installed from inside Claude Code with slash commands.
This installer does not paste or execute those commands for you.
EOF
  else
    log "Dry run: would prepare the Claude Code plugin command checklist"
  fi

  for id in "${selected[@]}"; do
    log "Installing or queuing: $id"
    install_item "$id"
  done

  echo
  echo "Done."
  echo "Log: $LOG_FILE"
  echo "Manifest: $MANIFEST"
  echo "Claude plugin command queue: $PLUGIN_COMMANDS"
  if [[ "$COMPLETE" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
    claude_bin="$(claude_path)"
    [[ -n "$claude_bin" ]] && launch_claude_code "$claude_bin"
  fi
  if [[ -s "$PLUGIN_COMMANDS" ]]; then
    echo
    echo "Open Claude Code and run the queued slash commands for plugin items."
  fi
}

main "$@"
