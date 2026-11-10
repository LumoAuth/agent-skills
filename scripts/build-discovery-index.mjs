#!/usr/bin/env node

// Builds the Agent Skills discovery index and one artifact per skill in dist/.
//
// Usage: node scripts/build-discovery-index.mjs <artifact-base-url>
//
// A skill that is a single SKILL.md is published as that file. A skill with
// more files is published as a .tar.gz archive with the skill's files at the
// archive root. Archives are byte-for-byte reproducible: entries are sorted,
// and every timestamp, owner and group is fixed.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  NAME_PATTERN,
  SKILLS_DIR,
  isExecutable,
  listFiles,
  listSkillDirectories,
  readSkill,
} from './lib.mjs';

const schema = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const baseUrl = process.argv[2];
const outputDirectory = 'dist';
const ARCHIVE_MTIME = Date.UTC(2000, 0, 1) / 1000;

if (!baseUrl) {
  console.error('Usage: node scripts/build-discovery-index.mjs <artifact-base-url>');
  process.exit(2);
}

const readMetadata = (directory) => {
  const { path, frontmatter } = readSkill(directory);
  const { name, description } = frontmatter;

  if (typeof name !== 'string' || typeof description !== 'string') {
    throw new Error(`Missing name or description in ${path}`);
  }
  if (
    name.length === 0 ||
    name.length > 64 ||
    !NAME_PATTERN.test(name) ||
    description.length === 0 ||
    description.length > 1024
  ) {
    throw new Error(`Invalid name or description in ${path}`);
  }
  if (name !== directory) {
    throw new Error(`Skill name "${name}" does not match directory "${directory}"`);
  }

  return { name, description: description.trim() };
};

/** One ustar header block for a regular file. */
const tarHeader = (name, size, mode) => {
  if (Buffer.byteLength(name) > 100) throw new Error(`Path too long for archive: ${name}`);

  const header = Buffer.alloc(512);
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';

  header.write(name, 0, 100, 'utf8');
  header.write(octal(mode, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii'); // uid
  header.write(octal(0, 8), 116, 8, 'ascii'); // gid
  header.write(octal(size, 12), 124, 12, 'ascii');
  header.write(octal(ARCHIVE_MTIME, 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii'); // checksum placeholder
  header.write('0', 156, 1, 'ascii'); // regular file
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

  return header;
};

const createArchive = (root, files) => {
  const blocks = [];
  for (const file of files) {
    const path = join(root, file);
    const content = readFileSync(path);
    blocks.push(tarHeader(file, content.length, isExecutable(path) ? 0o755 : 0o644));
    blocks.push(content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive marker
  return gzipSync(Buffer.concat(blocks), { level: 9 });
};

const createArtifact = (directory) => {
  const root = join(SKILLS_DIR, directory);
  const files = listFiles(root);

  if (files.length === 1 && files[0] === 'SKILL.md') {
    return { content: readFileSync(join(root, 'SKILL.md')), extension: 'md', type: 'skill-md' };
  }
  return { content: createArchive(root, files), extension: 'tar.gz', type: 'archive' };
};

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory);

const skills = listSkillDirectories()
  .map((directory) => {
    const metadata = readMetadata(directory);
    const artifact = createArtifact(directory);
    const filename = `${metadata.name}.${artifact.extension}`;
    writeFileSync(join(outputDirectory, filename), artifact.content);

    return {
      ...metadata,
      type: artifact.type,
      url: `${baseUrl.replace(/\/$/, '')}/${filename}`,
      digest: `sha256:${createHash('sha256').update(artifact.content).digest('hex')}`,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

if (new Set(skills.map(({ name }) => name)).size !== skills.length) {
  throw new Error('Skill names must be unique');
}

writeFileSync(
  join(outputDirectory, 'index.json'),
  `${JSON.stringify({ $schema: schema, skills }, null, 2)}\n`,
);

console.error(`Published ${skills.length} skills to ${outputDirectory}`);
