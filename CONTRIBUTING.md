# Contributing

Thanks for your interest in Claude Code Tools Installer (CCTI).

## Reporting problems and ideas

- **Bugs and feature or tool requests:** open an [issue](https://github.com/SteveKinzey/claude-code-tools-installer/issues/new/choose) using one of the forms.
- **Security vulnerabilities:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

The desktop app is an Electron application in `desktop/`.

```bash
cd desktop
npm install
npm run start
```

Run the full check suite before opening a pull request:

```bash
npm run check
```

## Pull requests

- Branch from `main` and keep each pull request to one focused change.
- Fill in the pull request template, including which platforms the change affects.
- Keep the safety boundaries described in the [README](README.md#safety-and-privacy-boundaries): nothing installs or removes anything without a plan the user reviews and confirms, and credentials are never collected automatically.
- Do not commit release binaries, local evidence folders, or credentials. Releases are built and published by the signed release workflows.

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE) and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
