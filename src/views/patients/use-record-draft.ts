import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Visit, VisitSave } from '@shared/clinical'
import { clinicalCall, notifyError } from '@/services/clinical'
import { registerPageSaveGuard } from '@/services/page-save-guard'
import { ElMessage, ElMessageBox } from 'element-plus'
import { parseCaseCreate } from '@shared/clinical-validation'

function payload(visit: Visit): VisitSave {
  return {
    id: visit.id,
    revision: visit.revision,
    date: visit.date || '',
    kind: visit.kind,
    patient: visit.patient,
    body: visit.body,
    categoryIds: visit.categoryIds
  }
}

function content(visit: Visit): string {
  return JSON.stringify([
    visit.id,
    visit.patientId,
    visit.doctorId,
    visit.date,
    visit.kind,
    visit.patient,
    visit.body,
    visit.categoryIds
  ])
}

export function useRecordDraft(
  onSaved: (visit: Visit) => void,
  afterRefreshSave?: () => Promise<void>
) {
  const records = ref<Visit[]>([]),
    saving = ref(false)
  const draft = computed(() => records.value.at(-1) || null)
  const savedContent = ref(new Map<string, string>())
  const changed = (visit: Visit) => content(visit) !== savedContent.value.get(visit.id)
  const dirty = computed(() => records.value.some(changed))
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<boolean> | null = null
  let leaving: Promise<boolean> | null = null
  let includeNew = false

  function open(visits: Visit[]) {
    clearTimeout(timer)
    records.value = structuredClone(visits)
    savedContent.value = new Map(visits.map((visit) => [visit.id, content(visit)]))
  }

  function append(visit: Visit) {
    if (records.value.some((item) => !item.id)) return
    savedContent.value.set(visit.id, content(visit))
    records.value.push(visit)
  }

  async function save(saveNew = true): Promise<boolean> {
    clearTimeout(timer)
    includeNew ||= saveNew
    if (pending) return pending
    const next = () => records.value.find((visit) => (visit.id ? changed(visit) : includeNew))
    if (!next()) {
      includeNew = false
      return true
    }
    saving.value = true
    pending = Promise.resolve().then(async () => {
      try {
        let current: Visit | undefined
        while ((current = next())) {
          const sent: Visit = JSON.parse(JSON.stringify(current))
          if (!sent.id && !sent.doctorId) throw new Error('请选择接诊医生')
          const result = sent.id
            ? await clinicalCall('saveVisit', payload(sent))
            : await clinicalCall(
                'createCase',
                parseCaseCreate({
                  patientId: sent.patientId || null,
                  doctorId: sent.doctorId,
                  date: sent.date,
                  kind: sent.kind,
                  patient: sent.patient,
                  body: sent.body,
                  categoryIds: sent.categoryIds
                })
              )
          // 首次入库只回填身份与版本，保存期间的新输入仍由下一轮队列提交。
          const previousId = current.id
          for (const target of [sent, current]) {
            target.id = result.id
            target.patientId = result.patientId
            target.recordNumber = result.recordNumber
            target.createdAt = result.createdAt
            target.doctorName = result.doctorName
          }
          current.revision = result.revision
          current.updatedAt = result.updatedAt
          if (previousId !== result.id) savedContent.value.delete(previousId)
          savedContent.value.set(result.id, content(sent))
          onSaved(result)
        }
        return true
      } catch (error) {
        notifyError(error)
        return false
      } finally {
        saving.value = false
        includeNew = false
        pending = null
      }
    })
    return pending
  }

  watch(
    () => records.value.map(content),
    () => {
      clearTimeout(timer)
      if (records.value.some((visit) => visit.id && changed(visit)))
        timer = setTimeout(() => {
          void save(false)
        }, 900)
    }
  )

  async function leave(): Promise<boolean> {
    if (leaving) return leaving
    if (!dirty.value && !saving.value) return true
    leaving = (async () => {
      try {
        if (await save()) return true
        await ElMessageBox.confirm('是否放弃尚未保存的修改？已保存的病历不会改变。', '离开病历', {
          confirmButtonText: '放弃修改',
          cancelButtonText: '继续编辑',
          closeOnClickModal: false
        })
        open([])
        return true
      } catch {
        return false
      } finally {
        leaving = null
      }
    })()
    return leaving
  }
  const disposeGuard = registerPageSaveGuard(async () => {
    if (!(await leave())) return false
    try {
      await afterRefreshSave?.()
      return true
    } catch (error) {
      notifyError(error)
      return false
    }
  })
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty.value && !saving.value) return
    event.preventDefault()
    event.returnValue = ''
    ElMessage.warning({
      message: '病历尚未保存，已保留当前页面；保存完成后可关闭或刷新',
      grouping: true
    })
    void save()
      .then(async (saved) => {
        if (saved) await afterRefreshSave?.()
      })
      .catch(notifyError)
  }
  window.addEventListener('beforeunload', beforeUnload)
  onBeforeUnmount(() => {
    clearTimeout(timer)
    disposeGuard()
    window.removeEventListener('beforeunload', beforeUnload)
  })
  return { records, draft, dirty, saving, changed, open, append, save, leave }
}
