import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/workflow.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
})
const { canAnalyze, readRoute, resolveStep, routeHash } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const pair = [{ phase: 'before' }, { phase: 'after' }]
const draft = { status: 'draft', documents: pair, result: null }

test('requires exactly one document on each side', () => {
  assert.equal(canAnalyze(draft), true)
  for (const documents of [[], [pair[0]], [pair[1]], [...pair, pair[0]]])
    assert.equal(canAnalyze({ documents }), false)
})
test('fresh and obsolete settings/history links open documents', () => {
  for (const hash of ['', '#settings', '#history', '#accounts', '#unknown'])
    assert.equal(readRoute(hash).step, 'documents')
})
test('old result links stay inside the results stage', () => {
  for (const section of ['findings', 'comparison', 'structure', 'report']) {
    assert.deepEqual(readRoute('#' + section), { step: 'results', section })
    assert.deepEqual(readRoute('#results/' + section), { step: 'results', section })
  }
  assert.equal(readRoute('#overview').step, 'results')
})
test('results are not shown before a successful analysis', () => {
  assert.equal(resolveStep('results', draft), 'analysis')
  assert.equal(resolveStep('results', { ...draft, documents: [] }), 'documents')
  assert.equal(resolveStep('analysis', { ...draft, documents: [pair[0]] }), 'documents')
})
test('running analysis stays on the progress stage', () => {
  for (const step of ['documents', 'analysis', 'results'])
    assert.equal(resolveStep(step, { ...draft, status: 'running' }), 'analysis')
})
test('failed reruns cannot show stale successful results', () => {
  assert.equal(resolveStep('results', { ...draft, status: 'failed', result: {} }), 'analysis')
})
test('successful results and backward navigation remain available', () => {
  for (const step of ['documents', 'analysis', 'results'])
    assert.equal(resolveStep(step, { ...draft, status: 'completed', result: {} }), step)
})
test('route serialization preserves the result section', () => {
  for (const hash of [
    '#documents',
    '#analysis',
    '#results',
    '#results/comparison',
    '#results/structure',
    '#results/report',
  ]) {
    const route = readRoute(hash)
    assert.deepEqual(readRoute('#' + routeHash(route)), route)
  }
})
