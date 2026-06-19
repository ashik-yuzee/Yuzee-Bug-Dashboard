// Module-level singleton — usable anywhere without context

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

export interface ToastItem {
  id: string
  type: ToastType
  title: string
  body?: string
  duration: number   // ms; 0 = sticky
  exiting?: boolean
}

type Listener = (toast: ToastItem) => void
type DismissListener = (id: string) => void

const onShow: Listener[] = []
const onDismiss: DismissListener[] = []

function generate(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const toast = {
  show(type: ToastType, title: string, body?: string, duration = 5000): string {
    const id = generate()
    onShow.forEach(l => l({ id, type, title, body, duration }))
    return id
  },
  success(title: string, body?: string, duration?: number) {
    return this.show('success', title, body, duration)
  },
  error(title: string, body?: string, duration = 8000) {
    return this.show('error', title, body, duration)
  },
  warning(title: string, body?: string, duration?: number) {
    return this.show('warning', title, body, duration)
  },
  info(title: string, body?: string, duration?: number) {
    return this.show('info', title, body, duration)
  },
  loading(title: string, body?: string): string {
    return this.show('loading', title, body, 0)
  },
  dismiss(id: string) {
    onDismiss.forEach(l => l(id))
  },
  /** Internal – used by ToastContainer */
  _onShow(fn: Listener) {
    onShow.push(fn)
    return () => { const i = onShow.indexOf(fn); if (i > -1) onShow.splice(i, 1) }
  },
  _onDismiss(fn: DismissListener) {
    onDismiss.push(fn)
    return () => { const i = onDismiss.indexOf(fn); if (i > -1) onDismiss.splice(i, 1) }
  },
}

export default toast
