import { createContext, useContext } from 'react'
import type { Health, Project, Source, View } from './types'
interface Workspace {
  project: Project
  health: Health | null
  reload: () => Promise<void>
  navigate: (view: View) => void
  openSource: (source: Source) => void
  openDocument: (id: string) => void
  openAnalysis: () => void
  notify: (text: string, error?: boolean) => void
  search: string
  setSearch: (value: string) => void
  setDocumentBusy: (value: boolean) => void
}
export const WorkspaceContext = createContext<Workspace | null>(null)
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('Workspace required')
  return context
}
