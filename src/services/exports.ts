import type { CaseExportInput, CaseExportProgress } from '@shared/exports'
import { bridge, unwrap } from './desktop'

export const exportCases = (input: CaseExportInput) =>
  unwrap(bridge().exportCases({ patientIds: [...input.patientIds] }))

export const exportPrescriptions = () => unwrap(bridge().exportPrescriptions())

export function onCaseExportProgress(listener: (progress: CaseExportProgress) => void) {
  return bridge().onCaseExportProgress(listener)
}
