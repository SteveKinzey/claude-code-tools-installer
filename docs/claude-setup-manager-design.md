# Claude Setup Manager Design

## Purpose

The desktop app is an **optional setup manager**. It does not assume that it installed Claude Code or any add-on. A person can use it before setup, after setup, or only to understand what is already on their computer.

## What the app looks for

The app reads only the known Claude Code locations after the person chooses **Check my setup**:

| Location | Plain-language purpose | Read-only discovery |
|---|---|---|
| `~/.claude/skills/` | Personal skills available in every project | Lists folders containing `SKILL.md` |
| `<chosen project>/.claude/skills/` | Skills for one shared project | Lists folders containing `SKILL.md` |
| `~/.claude/settings.json` | Personal Claude Code settings | Lists enabled plugins and connections |
| `<chosen project>/.claude/settings.json` | Settings shared with a project team | Lists enabled plugins and connections |
| `<chosen project>/.claude/settings.local.json` | Personal settings for one project | Lists enabled plugins and connections |
| `~/.claude.json` | Claude Code’s own local record | Lists known add-on references where safely readable |

The app never scans the entire computer, reads a project without the person selecting it, or changes a file during discovery.

## How the app presents results

The first view groups findings into **Already set up**, **May be duplicated**, **Needs attention**, and **Custom additions**. Every entry says where it was found, what it does in everyday language, and whether it affects only the person or everyone in a selected project.

An item is marked **May be duplicated** only when the same plugin, skill folder name, or connection name appears in more than one supported location. An item is marked **Needs attention** only when its settings JSON cannot be read, a configured source is missing, or two matching connection names point to different values. The app explains that a duplicate is not automatically an error because user, project, and personal-project settings can have different purposes.

## Cleanup safety rules

The app offers no automatic cleanup. A person first opens **Review changes**, chooses the exact item and scope, sees the file or command that would change, and confirms again. Shared-project changes are visibly labeled **Affects your team**. Managed settings are shown as read-only.

For plugins, the app uses the official Claude Code enable, disable, and uninstall commands only after confirmation. For skills, it offers a reversible disable or move-to-backup plan before any deletion. For settings entries, it shows the JSON key and the file that would be edited. No operation may remove a complete Claude folder, session history, or unrelated configuration as part of normal cleanup.

## Custom additions

People can choose **Add my own** and select either:

1. A local skill folder containing `SKILL.md`.
2. A local plugin marketplace folder containing `.claude-plugin/marketplace.json`.
3. A trusted HTTPS marketplace URL ending in `marketplace.json`.
4. A GitHub `owner/repository` marketplace source.

The app validates the local source or source format, explains whether it adds a skill or a marketplace, asks for User, Project, or Local scope where that choice applies, and shows the exact command or file change. It never executes a pasted shell command or accepts an arbitrary executable.

## Popularity data

The public catalog can show **Installs** only when an official Anthropic plugin page exposes that count. Package-registry values must say **downloads**, and GitHub stars, forks, and releases are discovery signals only. Every displayed metric needs a source URL and retrieved date. Items with no verified metric stay available but show no popularity number.
