#!/usr/bin/env node
// lib/validate.mjs — standalone validator CLI for a design-directions spec.json. No dependencies.
//
//   node lib/validate.mjs <spec.json>
//
// Exit 0 and prints "valid" if the file matches DESIGN_SPEC_SCHEMA (see designSchema.mjs).
// Exit 1 and lists every named error otherwise (missing field, wrong type, bad JSON, missing file).

import { readFileSync, existsSync } from 'node:fs';
import { validateDesignSpec } from './designSchema.mjs';

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node lib/validate.mjs <spec.json>');
    process.exit(1);
  }
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`Could not read ${path}: ${err.message}`);
    process.exit(1);
  }

  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    console.error(`${path} is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const { valid, errors } = validateDesignSpec(spec);
  if (valid) {
    console.log('valid');
    process.exit(0);
  }

  console.error(`${path} does not match the design spec schema:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

main();
