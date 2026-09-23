import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/workflow.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { canAnalyze, readRoute, resolveStep, routeHash } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const pair = [{ phase: 'before' }, { phase: 'after' }]
const draft = { status: 'draft', documents: pair, result: null }
const linksSource = await readFile(new URL('../src/findingLinks.ts', import.meta.url), 'utf8')
const linksJs = ts.transpileModule(linksSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { linkFindings } = await import(
  `data:text/javascript;base64,${Buffer.from(linksJs).toString('base64')}`
)

test('findings link to every affected function and are deduplicated within a row', () => {
  const before = { id: '1', document_id: 'old' }
  const after = { id: '2', document_id: 'new' }
  const other = { id: '3', document_id: 'new' }
  const finding = { id: 'risk', sources: [before, after, other] }
  const rows = [
    { id: 'a', before, after: [{ source: after }] },
    { id: 'b', before: null, after: [{ source: other }] },
  ]
  const result = linkFindings(rows, [finding])
  assert.deepEqual(result.byRow.get('a'), [finding])
  assert.deepEqual(result.byRow.get('b'), [finding])
  assert.deepEqual(result.unlinked, [])
})

test('unlinked findings stay visible and same segment IDs in different documents do not collide', () => {
  const row = {
    id: 'a',
    before: { id: '1', document_id: 'old' },
    after: [],
    nearest: { source: { id: '1', document_id: 'new' } },
  }
  const finding = { id: 'risk', sources: [{ id: '1', document_id: 'new' }] }
  const result = linkFindings([row], [finding])
  assert.deepEqual(result.byRow.get('a'), [])
  assert.deepEqual(result.unlinked, [finding])
  assert.deepEqual(linkFindings([], []).unlinked, [])
})

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
    const expected = { step: 'results', section: section === 'report' ? 'report' : 'comparison' }
    assert.deepEqual(readRoute('#' + section), expected)
    assert.deepEqual(readRoute('#results/' + section), expected)
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

test('cancelled runs keep navigation available without showing stale results', () => {
  const cancelled = { ...draft, status: 'cancelled', result: {} }
  assert.equal(resolveStep('results', cancelled), 'analysis')
  assert.equal(resolveStep('documents', cancelled), 'documents')
  assert.equal(resolveStep('analysis', cancelled), 'analysis')
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
