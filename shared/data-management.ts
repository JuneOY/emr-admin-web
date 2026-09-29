export type DataOperation = 'migrate' | 'backup' | 'restore'

export interface DataOperationResult {
  directory: string
  reload: boolean
}

export function parseDataOperation(input: unknown): DataOperation {
  if (input !== 'migrate' && input !== 'backup' && input !== 'restore')
    throw new Error('不支持此资料管理操作')
  return input
}
