import { useStore } from '../mock/store'
import { Spinner } from '../ui/primitives'
import { Check } from 'lucide-react'
import './ToastHost.css'

export default function ToastHost() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="ws-toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`ws-toast ws-toast-${t.tone}`}>
          {t.tone === 'progress' && <Spinner size={14} />}
          {t.tone === 'success' && <Check size={14} className="ws-toast-check" />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
