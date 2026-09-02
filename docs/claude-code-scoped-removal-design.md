# Scoped Claude Code removal design

## Official boundary

Anthropic's Advanced setup documentation lists removal steps by installation method. For native macOS, Linux, and WSL installations, it removes the Claude launcher in `~/.local/bin/claude` and the native version directory in `~/.local/share/claude`. It separately describes deleting `~/.claude` and `~/.claude.json` as removing Claude Code settings, allowed-tool settings, MCP configuration, and session history. Its full-removal note also says to uninstall the VS Code extension, JetBrains plugin, and Desktop app.

> CCTI must not use that broad full-removal note for a person who asked to keep Claude Desktop and Chrome unchanged.

Source: https://code.claude.com/docs/en/setup#uninstall-claude-code, read 2026-09-02.

## CCTI contract

The CCTI removal flow will be named **Remove Claude Code CLI**. It will not be called **Start fresh** or suggest that it removes every Anthropic product.

The review must distinguish three groups. The default review includes only a verified Claude Code CLI install managed by a known package method or native Claude path. An optional separate checkbox can include known Claude Code CLI settings and session files. CCTI-managed runtime and installer notes are a third group. The review permanently excludes Claude Desktop, Claude in Chrome, browser profiles, browser extensions, macOS application-support folders for the Desktop app, Windows app data belonging to the Desktop app, and unrelated Anthropic software.

The app will first gather supported installation evidence, then show an exact removal plan. The person must type **REMOVE CLAUDE CODE** to run it. An unrecognized launcher, an unknown package manager, an elevated system package manager, or a path outside a known scope remains a no-change attention item with a clear explanation. The renderer receives only a short-lived opaque review ID and cannot submit a path or command.

## Run contract

Claude Code is a terminal-based interactive session. **Run Claude Code** will open the operating system's normal terminal at the selected project folder, or the user home folder if no project is chosen, and start the verified `claude` command. It does not ask the user to type a command. On a platform without a supported terminal launcher, it returns a no-change message instead of creating a shell command or pretending the session opened.
