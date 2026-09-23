import type { Finding, Mapping, Source } from './types'

const sourceKey = (source: Source) => `${source.document_id}:${source.id}`
export function linkFindings(rows: Mapping[], findings: Finding[]) {
  const bySource = new Map<string, Finding[]>()
  for (const finding of findings) {
    for (const source of finding.sources) {
      const key = sourceKey(source)
      bySource.set(key, [...(bySource.get(key) || []), finding])
    }
  }
  const linked = new Set<string>()
  const byRow = new Map<string, Finding[]>()
  for (const row of rows) {
    const sources = [...(row.before ? [row.before] : []), ...row.after.map((a) => a.source)]
    const unique = new Map<string, Finding>()
    for (const source of sources) {
      for (const finding of bySource.get(sourceKey(source)) || []) {
        unique.set(finding.id, finding)
        linked.add(finding.id)
      }
    }
    byRow.set(row.id, [...unique.values()])
  }
  return { byRow, unlinked: findings.filter((finding) => !linked.has(finding.id)) }
}
