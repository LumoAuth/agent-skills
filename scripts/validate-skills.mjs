#!/usr/bin/env node

// Validates every skill against the Agent Skills specification
// (https://agentskills.io/specification) and against the rules of this
// repository (see AGENTS.md).
//
// Usage: node scripts/validate-skills.mjs [--json]
//
// Status goes to stderr. With --json, a machine-readable report goes to stdout.
// Exit code 1 when any skill has an error; warnings do not fail the run.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import {
  ALLOWED_FIELDS,
  NAME_PATTERN,
  SKILLS_DIR,
  isExecutable,
  listFiles,
  listSkillDirectories,
  readSkill,
} from './lib.mjs';

const MAX_SKILL_LINES = 500;
const RECOMMENDED_BODY_TOKENS = 5000;
const RECOMMENDED_REFERENCE_LINES = 500;
const NAME_PREFIX = 'lumoauth-';

// Wording that does not belong in a skill for the hosted service.
const CONTENT_WARNINGS = [
  [/self[- ]host/i, 'mentions self-hosting'],
  [/\b(Developer|Startup|Growth|Business|Enterprise) plan\b/, 'names a plan'],
];

const json = process.argv.includes('--json');
const report = [];

const stripCode = (markdown) =>
  markdown.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');

/** Relative link targets in a Markdown file (code blocks and URLs excluded). */
const relativeLinks = (markdown) => {
  const targets = [];
  for (const match of stripCode(markdown).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
    targets.push(target);
  }
  return targets;
};

const validateFrontmatter = (directory, frontmatter, errors) => {
  for (const key of Object.keys(frontmatter)) {
    if (!ALLOWED_FIELDS.has(key)) errors.push(`unknown frontmatter field "${key}"`);
  }

  const { name, description, license, compatibility, metadata } = frontmatter;

  if (typeof name !== 'string' || name.length === 0) {
    errors.push('"name" is required');
  } else {
    if (name.length > 64) errors.push('"name" is longer than 64 characters');
    if (!NAME_PATTERN.test(name)) {
      errors.push('"name" must be lowercase letters, digits and single hyphens');
    }
    if (name !== directory) errors.push(`"name" (${name}) does not match the directory`);
    if (!name.startsWith(NAME_PREFIX)) errors.push(`"name" must start with "${NAME_PREFIX}"`);
  }

  if (typeof description !== 'string' || description.trim().length === 0) {
    errors.push('"description" is required');
  } else if (description.length > 1024) {
    errors.push(`"description" is ${description.length} characters (limit 1024)`);
  }

  if (license !== undefined && typeof license !== 'string') {
    errors.push('"license" must be a string');
  }
  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string' || compatibility.length === 0) {
      errors.push('"compatibility" must be a non-empty string');
    } else if (compatibility.length > 500) {
      errors.push('"compatibility" is longer than 500 characters');
    }
  }
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      errors.push('"metadata" must be a mapping');
    } else {
      for (const [key, value] of Object.entries(metadata)) {
        if (typeof value !== 'string') {
          errors.push(`metadata.${key} must be a string (quote it in YAML)`);
        }
      }
    }
  }
  if (
    frontmatter['allowed-tools'] !== undefined &&
    typeof frontmatter['allowed-tools'] !== 'string'
  ) {
    errors.push('"allowed-tools" must be a space-separated string');
  }
};

const validateSkill = (directory) => {
  const errors = [];
  const warnings = [];
  const root = join(SKILLS_DIR, directory);

  if (!existsSync(join(root, 'SKILL.md'))) {
    return { skill: directory, errors: ['SKILL.md is missing'], warnings };
  }

  let skill;
  try {
    skill = readSkill(directory);
  } catch (error) {
    return { skill: directory, errors: [error.message], warnings };
  }

  validateFrontmatter(directory, skill.frontmatter, errors);

  const lines = skill.source.split('\n').length;
  if (lines > MAX_SKILL_LINES) {
    errors.push(`SKILL.md is ${lines} lines (limit ${MAX_SKILL_LINES})`);
  }
  const tokens = Math.round(skill.body.length / 4);
  if (tokens > RECOMMENDED_BODY_TOKENS) {
    warnings.push(`SKILL.md body is about ${tokens} tokens (recommended < ${RECOMMENDED_BODY_TOKENS})`);
  }
  if (!/^# \S/m.test(skill.body)) errors.push('SKILL.md has no top-level heading');

  const files = listFiles(root);
  const linked = new Set(['SKILL.md']);

  for (const file of files.filter((name) => name.endsWith('.md'))) {
    const markdown = readFileSync(join(root, file), 'utf8');
    for (const target of relativeLinks(markdown)) {
      const resolved = normalize(join(dirname(file), target)).split('\\').join('/');
      if (resolved.startsWith('..')) {
        errors.push(`${file}: link "${target}" leaves the skill directory`);
      } else if (!existsSync(join(root, resolved))) {
        errors.push(`${file}: link "${target}" points to a missing file`);
      } else if (file === 'SKILL.md') {
        linked.add(resolved);
      }
    }
    if (file !== 'SKILL.md') {
      const count = markdown.split('\n').length;
      if (count > RECOMMENDED_REFERENCE_LINES) {
        warnings.push(`${file} is ${count} lines (recommended < ${RECOMMENDED_REFERENCE_LINES})`);
      }
    }
    for (const [pattern, message] of CONTENT_WARNINGS) {
      if (pattern.test(markdown)) warnings.push(`${file}: ${message}`);
    }
  }

  // Scripts are named in prose or code, not always linked.
  for (const file of files) {
    if (file === 'SKILL.md' || linked.has(file)) continue;
    if (skill.body.includes(file)) continue;
    warnings.push(`${file} is not referenced from SKILL.md`);
  }

  for (const file of files.filter((name) => name.startsWith('scripts/'))) {
    const path = join(root, file);
    const firstLine = readFileSync(path, 'utf8').split('\n', 1)[0];
    if (/\.(sh|mjs|py)$/.test(file)) {
      if (!firstLine.startsWith('#!')) errors.push(`${file} has no shebang line`);
      if (!isExecutable(path)) errors.push(`${file} is not executable (chmod +x)`);
    }
  }

  return { skill: directory, lines, tokens, files: files.length, errors, warnings };
};

const validateGroupings = (directories) => {
  const errors = [];
  if (!existsSync('skills.sh.json')) return ['skills.sh.json is missing'];

  let config;
  try {
    config = JSON.parse(readFileSync('skills.sh.json', 'utf8'));
  } catch (error) {
    return [`skills.sh.json is not valid JSON: ${error.message}`];
  }

  const grouped = (config.groupings ?? []).flatMap((group) => group.skills ?? []);
  const seen = new Set();
  for (const name of grouped) {
    if (seen.has(name)) errors.push(`skills.sh.json lists "${name}" twice`);
    seen.add(name);
    if (!directories.includes(name)) errors.push(`skills.sh.json lists unknown skill "${name}"`);
  }
  for (const directory of directories) {
    if (!seen.has(directory)) errors.push(`skills.sh.json does not list "${directory}"`);
  }
  return errors;
};

const directories = listSkillDirectories();
for (const directory of directories) report.push(validateSkill(directory));
const groupingErrors = validateGroupings(directories);

let errorCount = groupingErrors.length;
let warningCount = 0;

for (const entry of report) {
  errorCount += entry.errors.length;
  warningCount += entry.warnings.length;
  if (entry.errors.length === 0 && entry.warnings.length === 0) continue;
  console.error(`\n${entry.skill}`);
  for (const message of entry.errors) console.error(`  error    ${message}`);
  for (const message of entry.warnings) console.error(`  warning  ${message}`);
}
if (groupingErrors.length > 0) {
  console.error('\nskills.sh.json');
  for (const message of groupingErrors) console.error(`  error    ${message}`);
}

console.error(
  `\n${directories.length} skills checked: ${errorCount} error(s), ${warningCount} warning(s)`,
);

if (json) {
  console.log(JSON.stringify({ skills: report, groupingErrors, errorCount, warningCount }, null, 2));
}

process.exit(errorCount > 0 ? 1 : 0);
