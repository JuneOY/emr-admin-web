/** 通用表格组件使用的分页契约。 */
declare namespace Api {
  namespace Common {
    interface PaginationParams {
      current: number
      size: number
      total: number
    }
    interface PaginatedResponse<T = unknown> {
      records: T[]
      current: number
      size: number
      total: number
    }
  }
}
