#!/usr/bin/env node
// `hatch-apply`: one file for a project's build — apply and verify, nothing else, never a
// question. Built into a single executable by scripts/build-apply-bin.mjs; no top-level
// await, so it bundles into CommonJS.
import { main } from '../cli/hatch-apply.ts';

void main(process.argv.slice(2));
