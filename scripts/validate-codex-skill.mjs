import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = path.join(repositoryRoot, 'skills', 'retake-whiteboard-codex', 'SKILL.md');
const allowedProperties = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
const maximumNameLength = 64;
const maximumDescriptionLength = 1024;

try {
  const content = await readFile(skillPath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail('Invalid or missing YAML frontmatter.');

  let frontmatter;
  try {
    frontmatter = parse(match[1]);
  } catch (error) {
    fail(`Invalid YAML in frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    fail('Frontmatter must be a YAML dictionary.');
  }

  const unexpectedKeys = Object.keys(frontmatter).filter((key) => !allowedProperties.has(key));
  if (unexpectedKeys.length > 0) {
    fail(`Unexpected frontmatter key(s): ${unexpectedKeys.sort().join(', ')}.`);
  }

  if (!Object.hasOwn(frontmatter, 'name')) fail("Missing 'name' in frontmatter.");
  if (!Object.hasOwn(frontmatter, 'description')) fail("Missing 'description' in frontmatter.");

  const name = frontmatter.name;
  if (typeof name !== 'string') fail('Name must be a string.');
  const trimmedName = name.trim();
  if (trimmedName.length > maximumNameLength) {
    fail(`Name is too long (${trimmedName.length} characters; maximum ${maximumNameLength}).`);
  }
  if (trimmedName && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmedName)) {
    fail(`Name '${trimmedName}' must use lower-case hyphen-case.`);
  }

  const description = frontmatter.description;
  if (typeof description !== 'string') fail('Description must be a string.');
  const trimmedDescription = description.trim();
  if (trimmedDescription.length > maximumDescriptionLength) {
    fail(
      `Description is too long (${trimmedDescription.length} characters; maximum ${maximumDescriptionLength}).`,
    );
  }
  if (/[<>]/.test(trimmedDescription)) {
    fail('Description cannot contain angle brackets (< or >).');
  }

  console.log('Skill is valid!');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function fail(message) {
  throw new Error(message);
}
