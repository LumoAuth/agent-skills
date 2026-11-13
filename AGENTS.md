# AGENTS.md

This file guides AI coding agents (Claude Code, Cursor, Copilot, Codex and others) that work in this repository.

## Repository overview

A collection of skills for AI coding agents that work with [LumoAuth](https://lumoauth.dev), the identity platform for apps and AI agents. Each skill is a folder of instructions that an agent loads when a task matches. The skills follow the [Agent Skills](https://agentskills.io/) format.

LumoAuth is a hosted service. The skills describe the hosted product only:

- US region: `https://app.lumoauth.dev`
- EU region: `https://eu.app.lumoauth.dev`
- Every API path is scoped to an organization: `{base}/orgs/{orgId}/api/v1/...`, where `{orgId}` is the organization slug.

## Layout

```
skills/
  {skill-name}/           # kebab-case, always starts with "lumoauth-"
    SKILL.md              # Required: frontmatter + instructions
    references/           # Optional: detail that is loaded on demand
    scripts/              # Optional: executable helpers
    assets/               # Optional: templates and data files
scripts/
  validate-skills.mjs     # Checks every skill against the Agent Skills spec
  build-discovery-index.mjs
skills.sh.json            # Groupings shown on skills.sh
.claude-plugin/
  plugin.json             # Claude Code plugin: every skill plus the LumoAuth MCP server
  marketplace.json        # Lets `/plugin install lumoauth --marketplace lumoauth/agent-skills` work
  icon.png                # Listing icon, 1024 x 1024
```

The plugin manifest states the number of skills in its `description`. Update it, and the counts in `README.md`, when a skill is added or removed.

## Creating or editing a skill

### Naming

- **Skill directory**: `kebab-case`, prefixed with `lumoauth-` (for example `lumoauth-nextjs`).
- **`name` in the frontmatter**: identical to the directory name.
- **`SKILL.md`**: always uppercase, always this exact filename.
- **Reference files**: `references/{topic}.md` in kebab-case.
- **Scripts**: `scripts/{name}.sh` or `scripts/{name}.mjs`.

### SKILL.md format

```markdown
---
name: lumoauth-{topic}
description: {What the skill does, then when to use it. Third person. Include the phrases and keywords a user would type, such as package names, framework names and feature names. 1024 characters at most.}
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# {Title}

{One short paragraph: what the agent can do with this skill.}

## When to use

{Bullets. Also say when NOT to use it and name the skill that fits instead.}

## Before you start

{The values the agent needs (organization slug, client ID, redirect URI, API key) and where each one comes from: the portal page, or the `lumo` CLI command. Tell the agent to ask the user for a value that it cannot find. Never guess one.}

## Steps

{Numbered, concrete, copy-paste ready. One path, not a menu of options.}

## Verify

{How to prove that the change works.}

## Common mistakes

{Symptom, cause, fix.}

## Related skills

{Other skills in this repository, by name.}

## References

{Links to files under references/ and to pages on https://docs.lumoauth.dev.}
```

Sections can be renamed or dropped when they do not fit, but every skill says when to use it, what the agent needs first, what to do and how to verify the result.

### Context efficiency

Agents load only `name` and `description` at startup. The body of `SKILL.md` is loaded when the skill activates, and the files under `references/` are loaded only when the agent opens them.

- Keep `SKILL.md` under 500 lines and under about 5,000 tokens. Aim for 120 to 300 lines.
- Put the main path in `SKILL.md`. Move long option tables, per-language variants and rare cases to `references/`.
- Link to reference files with relative paths, one level deep: `[PKCE details](references/pkce.md)`. A reference file does not link to another reference file as a required next step.
- Say when to open each reference file ("Read `references/dpop.md` when the client must send sender-constrained tokens").

### Accuracy

A skill is executed, not just read. A wrong function name costs the user a failed run.

- Every package name, import, function, option, endpoint, scope, environment variable and CLI flag comes from the SDK source, the CLI source or the published documentation. Do not write one from memory.
- When the documentation and the source disagree, follow the source.
- Leave out anything that cannot be confirmed.
- Use `acme-corp` as the example organization slug. Read every secret from an environment variable. Never write a real key, token or secret.

### Content rules

- Describe the hosted service only. Configuration happens in the organization's portal (`/orgs/{orgId}/portal/...`), through the Admin API or with the `lumo` CLI.
- Do not state plan names, prices or limits. They change. When a feature depends on the plan, write that availability depends on the organization's plan and link to `https://docs.lumoauth.dev/pricing-matrix`.
- Never put a client secret, API key or agent secret in browser or mobile code. Say so wherever a skill handles one.
- A skill tells the agent to show the user every command that creates, changes or deletes something in the organization before it runs the command.
- Plain English, imperative mood, short sentences. Write "the key that the agent holds", not "the key the agent holds". Prefer the common word.

### Scripts

- Bash scripts: `#!/bin/bash` and `set -e`. Node scripts: `#!/usr/bin/env node` and `.mjs`.
- Write status messages to stderr and machine-readable output (JSON) to stdout.
- Add a cleanup trap when a script creates temporary files.
- Reference scripts by a path relative to the skill root, for example `bash scripts/check-org.sh acme-corp`.
- A script is tested before it is committed.

## Checks

```bash
npm ci --ignore-scripts
node scripts/validate-skills.mjs                              # spec + repository rules
node scripts/build-discovery-index.mjs https://example.com/skills   # builds dist/
```

`validate-skills.mjs` fails when a skill has invalid frontmatter, when `name` does not match its directory, when `SKILL.md` is longer than 500 lines, when a relative link points to a missing file, or when a skill is missing from `skills.sh.json`.

## End-user installation

```bash
npx skills add lumoauth/agent-skills                     # choose from the list
npx skills add lumoauth/agent-skills --skill lumoauth-nextjs
```

Manual install for Claude Code:

```bash
cp -r skills/lumoauth-nextjs ~/.claude/skills/
```

On claude.ai, add the skill folder to project knowledge or paste the contents of `SKILL.md` into the conversation.
