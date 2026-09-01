# Security Policy

Claude Code Tools Installer is a desktop app and set of setup scripts that install Claude Code, a Node.js runtime, and curated third-party tools on your machine. Because it downloads and runs software on your behalf, security reports are taken seriously.

## Supported Versions

Releases are dated builds (for example, v2026.08.12). Security fixes are applied only to the latest release. Please update to the newest version before reporting an issue you can no longer reproduce there.

| Version | Supported |
| ------- | --------- |
| Latest release | :white_check_mark: |
| Older releases | :x: |

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

Instead, report privately using one of these channels:

- **GitHub private vulnerability reporting** (preferred): go to the [Security tab](https://github.com/SteveKinzey/claude-code-tools-installer/security) and choose "Report a vulnerability."
- **Email**: steve@sk-america.com with "SECURITY" in the subject line.

Please include, where possible: a description of the issue and its impact, steps to reproduce, the release version and platform (macOS, Windows, or Linux), and any relevant logs or screenshots.

### What to expect

- Acknowledgment of your report within 3 business days.
- A status update as the report is investigated, typically within 14 days.
- If confirmed, a fix in the next release and credit in the release notes (unless you prefer to remain anonymous).
- If declined, an explanation of why it is not considered a vulnerability.

## Scope

In scope:

- The desktop app (macOS, Windows, Linux builds)
- The setup adapters: `setup-my-claude.sh`, `setup-my-claude-linux.sh`, `setup-my-claude.ps1`
- Download and checksum verification logic (for example, the SHA-256 verification of the Node.js runtime)
- Anything that could cause the installer to run unintended code, escalate privileges, or install something the user did not confirm

Out of scope:

- Vulnerabilities in the third-party tools, MCP servers, plugins, or Convex components that the installer offers — please report those to the upstream project
- Vulnerabilities in Claude Code itself — report those to [Anthropic](https://www.anthropic.com/responsible-disclosure-policy)
- Issues that require a machine that is already compromised

## Security Design Notes

For context when assessing reports, the installer is designed so that:

- Nothing installs without explicit user confirmation — every action shows a plan before it runs
- There is no `curl | bash` pattern; users download packaged releases and run them locally
- The Node.js runtime is verified against official SHA-256 checksums before use
- Credentials are never collected automatically; credential-sensitive plugin steps are saved to a checklist for the user to run themselves
- Telemetry is off by default, and optional counts contain no paths or tool lists

Reports that identify gaps between these guarantees and actual behavior are especially valuable.
