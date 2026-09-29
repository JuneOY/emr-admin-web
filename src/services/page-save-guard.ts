let guard: (() => Promise<boolean>) | null = null

export function registerPageSaveGuard(save: () => Promise<boolean>): () => void {
  guard = save
  return () => {
    if (guard === save) guard = null
  }
}

export async function saveBeforeRefresh(): Promise<boolean> {
  return guard ? guard() : true
}
