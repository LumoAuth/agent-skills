// Shared helpers for the repository scripts.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';

export const SKILLS_DIR = 'skills';

// https://agentskills.io/specification
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

export const listSkillDirectories = () =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/** Every file under `directory`, as sorted POSIX-style relative paths. */
export const listFiles = (directory) => {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(directory, path).split(sep).join('/'));
      else throw new Error(`Unsupported entry (not a regular file): ${path}`);
    }
  };
  walk(directory);
  return files.sort();
};

/** Splits a SKILL.md into its parsed frontmatter and its Markdown body. */
export const readSkill = (directory) => {
  const path = join(SKILLS_DIR, directory, 'SKILL.md');
  const source = readFileSync(path, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`Missing YAML frontmatter in ${path}`);

  let frontmatter;
  try {
    frontmatter = parse(match[1]);
  } catch (error) {
    throw new Error(`Invalid YAML frontmatter in ${path}: ${error.message}`);
  }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Frontmatter in ${path} is not a mapping`);
  }

  return { path, source, frontmatter, body: source.slice(match[0].length) };
};

export const isExecutable = (path) => (statSync(path).mode & 0o111) !== 0;
