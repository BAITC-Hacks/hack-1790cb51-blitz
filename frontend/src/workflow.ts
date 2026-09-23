import type { Project } from './types'
export type Step = 'documents' | 'analysis' | 'results'
export type ResultSection = 'comparison' | 'report'
export interface Route {
  step: Step
  section: ResultSection
}
export const canAnalyze = (project: Pick<Project, 'documents'>) =>
  (['before', 'after'] as const).every(
    (phase) => project.documents.filter((d) => d.phase === phase).length === 1,
  )
export function readRoute(hash: string): Route {
  const value = hash.replace(/^#/, '')
  const section = value.replace(/^results\//, '')
  if (['findings', 'comparison', 'structure', 'report'].includes(section))
    return { step: 'results', section: section === 'report' ? 'report' : 'comparison' }
  if (value === 'results' || value === 'overview') return { step: 'results', section: 'comparison' }
  return { step: value === 'analysis' ? 'analysis' : 'documents', section: 'comparison' }
}
export function routeHash(route: Route): string {
  return route.step === 'results' && route.section !== 'comparison'
    ? `results/${route.section}`
    : route.step
}
export function resolveStep(
  requested: Step,
  project: Pick<Project, 'status' | 'documents' | 'result'>,
): Step {
  if (project.status === 'running') return 'analysis'
  if (requested === 'results' && (!project.result || project.status !== 'completed'))
    return canAnalyze(project) ? 'analysis' : 'documents'
  if (requested === 'analysis' && !canAnalyze(project)) return 'documents'
  return requested
}
