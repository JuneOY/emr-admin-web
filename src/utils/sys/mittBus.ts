import mitt, { type Emitter } from 'mitt'

// 只保留实际存在的全局交互。
type Events = {
  openSetting: void
  openSearchDialog: void
}
const mittBus: Emitter<Events> = mitt<Events>()
export default mittBus
