export type View = 'documents' | 'analysis' | 'results' | 'comparison' | 'findings' | 'report'
export type Phase = 'before' | 'after'
export interface Segment {
  id: string
  text: string
  locator: string
  department: string
  is_function: boolean
  is_section_heading?: boolean
  section_path?: { id: string; text: string }[]
  manual?: boolean
}
export interface Source extends Segment {
  document_id: string
  document_name: string
  phase: Phase
}
export interface Document {
  id: string
  name: string
  phase: Phase
  size: number
  created_at: string
  function_count: number
  departments: string[]
  warnings: string[]
  segments?: Segment[]
}
export interface Finding {
  id: string
  kind: 'loss' | 'duplication' | 'conflict'
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  sources: Source[]
  recommendation: string
  score: number | null
  status: 'pending' | 'confirmed' | 'dismissed'
  note: string
}
export interface Mapping {
  id: string
  before: Source | null
  after: { source: Source; score: number; method: string }[]
  status: 'retained' | 'transferred' | 'lost' | 'new'
  reason?: string
  nearest: { source: Source; score: number } | null
}
export interface Department {
  name: string
  status: 'retained' | 'reorganized' | 'removed' | 'created'
  targets: string[]
  before_count: number
  after_count: number
  sources?: Source[]
}
export interface Stats {
  before_functions: number
  after_functions: number
  before_departments: number
  after_departments: number
  retained: number
  transferred: number
  lost: number
  new: number
  coverage: number
  risks: number
  high_risks: number
  duplications: number
  conflicts: number
}
export interface Result {
  id: string
  created_at: string
  engine: string
  warnings: string[]
  stats: Stats
  mapping: Mapping[]
  departments: Department[]
  before_departments?: string[]
  after_departments?: string[]
  findings: Finding[]
  summary: string
  methodology: string
  revision: number
  document_count: number
  usage: Record<string, number>
}
export interface Project {
  id: string
  name: string
  organization: string
  created_at: string
  is_demo: boolean
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled'
  analysis_token?: string | null
  progress: number
  stage: string
  error: string | null
  result: Result | null
  documents: Document[]
  runs: { id: string; created_at: string; revision: number }[]
}
export interface ProjectList extends Omit<Project, 'documents' | 'result' | 'runs'> {
  document_count: number
  stats: Stats | null
}
export interface Health {
  status: string
  gpt_configured: boolean
  model: string
  version: string
}
