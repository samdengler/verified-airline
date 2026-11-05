// Runs every line of a build's decisions.jsonl through the TypeScript checks
// and fails on any answer that differs from the model's.  `npm test` runs the
// same lines against model/one-id/ (src/app/one-id/rules/conformance.spec.ts);
// this takes any directory, so scripts/check_one_id.py can test a fresh build.
//
//   node scripts/one-id-vectors.mjs --model ../model/one-id
import { deepStrictEqual } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const dir = resolve(args[args.indexOf('--model') + 1]);
const entry = new URL('../src/app/one-id/rules/support/answer.ts', import.meta.url).pathname;

// The checks read their identifier constants from this build's model.json.
const thisModel = {
  name: 'this-model',
  setup(b) {
    b.onResolve({ filter: /model\/one-id\/model\.json$/ }, () => ({ path: resolve(dir, 'model.json') }));
  },
};
const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [thisModel], logLevel: 'error' });
const { answer } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const files = ['decisions.jsonl', 'presentation/decisions.jsonl'].map((f) => resolve(dir, f)).filter(existsSync);
const rows = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const failed = [];
for (const row of rows) {
  try {
    deepStrictEqual(answer(row.request), row.response.result);
  } catch (e) {
    failed.push(`${row.name}\n  model: ${JSON.stringify(row.response.result)}\n  got: ${e.actual === undefined ? e.message : JSON.stringify(e.actual)}`);
  }
}
if (failed.length) {
  console.error(`one-id-vectors: ${failed.length} of ${rows.length} lines differ\n${failed.join('\n')}`);
  process.exit(1);
}
console.log(`one-id-vectors: all ${rows.length} lines of the model's decisions agree with the TypeScript checks`);
