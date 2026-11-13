#!/usr/bin/env node
// Static checks for n8n workflow exports in ../workflows (no dependencies).
//   node scripts/validate-workflows.mjs [dir]
// Checks: valid JSON, required top-level fields, every node has id/name/type/typeVersion/position,
// unique node ids and names, connections only reference existing nodes, no orphan nodes,
// credentials referenced by name only (no embedded secrets), errorWorkflow points to a known id.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] ?? join(here, '..', 'workflows'));
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

const SECRET_PATTERNS = [/sk-[A-Za-z0-9_-]{20,}/, /sk-ant-[A-Za-z0-9_-]{10,}/, /\d{8,10}:[A-Za-z0-9_-]{35}/, /AIza[0-9A-Za-z_-]{35}/];
const TRIGGER_TYPES = /(webhook|Trigger|errorTrigger|scheduleTrigger|manualTrigger)$/i;

let failed = 0;
const workflows = [];

for (const file of files) {
  const errors = [];
  const warnings = [];
  const raw = readFileSync(join(dir, file), 'utf8');
  let wf;
  try {
    wf = JSON.parse(raw);
  } catch (e) {
    console.log(`FAIL ${file}: invalid JSON (${e.message})`);
    failed++;
    continue;
  }

  for (const key of ['name', 'nodes', 'connections']) if (!(key in wf)) errors.push(`missing top-level "${key}"`);
  if (!Array.isArray(wf.nodes)) errors.push('"nodes" must be an array');
  const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];

  const ids = new Set();
  const names = new Set();
  nodes.forEach((n, i) => {
    const label = n.name ?? `#${i}`;
    if (typeof n.id !== 'string' || !n.id) errors.push(`node ${label}: missing id`);
    if (typeof n.name !== 'string' || !n.name) errors.push(`node #${i}: missing name`);
    if (typeof n.type !== 'string' || !n.type.includes('.')) errors.push(`node ${label}: missing/invalid type`);
    if (typeof n.typeVersion !== 'number') errors.push(`node ${label}: missing typeVersion`);
    if (!Array.isArray(n.position) || n.position.length !== 2 || !n.position.every(Number.isFinite))
      errors.push(`node ${label}: position must be [x, y]`);
    if (!n.parameters || typeof n.parameters !== 'object') errors.push(`node ${label}: missing parameters object`);
    if (ids.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    if (names.has(n.name)) errors.push(`duplicate node name "${n.name}"`);
    ids.add(n.id);
    names.add(n.name);
    for (const [credType, ref] of Object.entries(n.credentials ?? {})) {
      if (!ref?.name) errors.push(`node ${label}: credential ${credType} has no name`);
      if (ref?.id) warnings.push(`node ${label}: credential ${credType} has a hard-coded id (${ref.id})`);
    }
    if (n.type.endsWith('.webhook') && !n.webhookId) warnings.push(`node ${label}: webhook without webhookId`);
  });

  // Connections
  const connected = new Set();
  for (const [source, outputs] of Object.entries(wf.connections ?? {})) {
    if (!names.has(source)) errors.push(`connection source "${source}" is not a node`);
    connected.add(source);
    for (const [type, branches] of Object.entries(outputs)) {
      if (!Array.isArray(branches)) { errors.push(`connections.${source}.${type} must be an array`); continue; }
      branches.forEach((branch, bi) => {
        (branch ?? []).forEach((c) => {
          if (!names.has(c.node)) errors.push(`connection ${source} -[${type}:${bi}]-> "${c.node}" targets a missing node`);
          if (c.type !== type) errors.push(`connection ${source} -> ${c.node}: type "${c.type}" != "${type}"`);
          if (typeof c.index !== 'number') errors.push(`connection ${source} -> ${c.node}: missing index`);
          connected.add(c.node);
        });
      });
    }
  }
  for (const n of nodes) {
    if (n.type === 'n8n-nodes-base.stickyNote') continue;
    if (!connected.has(n.name) && !TRIGGER_TYPES.test(n.type)) warnings.push(`node "${n.name}" is not connected`);
  }
  if (!nodes.some((n) => TRIGGER_TYPES.test(n.type))) warnings.push('no trigger node');

  for (const p of SECRET_PATTERNS) if (p.test(raw)) errors.push(`possible secret matching ${p}`);

  workflows.push({ file, wf });
  const status = errors.length ? 'FAIL' : 'OK  ';
  if (errors.length) failed++;
  console.log(`${status} ${file}  (${nodes.length} nodes, "${wf.name}")`);
  errors.forEach((e) => console.log(`     error: ${e}`));
  warnings.forEach((w) => console.log(`     warn:  ${w}`));
}

// Cross-file: errorWorkflow references
const knownIds = new Set(workflows.map(({ wf }) => wf.id).filter(Boolean));
for (const { file, wf } of workflows) {
  const ref = wf.settings?.errorWorkflow;
  if (ref && !knownIds.has(ref)) {
    console.log(`FAIL ${file}: settings.errorWorkflow "${ref}" does not match any workflow id in ${dir}`);
    failed++;
  }
}

console.log(`\n${files.length - failed}/${files.length} workflow files passed.`);
process.exit(failed ? 1 : 0);
