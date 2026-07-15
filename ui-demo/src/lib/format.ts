import { t, currentLang } from '../i18n'

export function relTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.round(diff / 60000)
  if (m < 1) return t('misc.timeJustNow')
  if (m < 60) return t('misc.timeMinutesAgo', { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return t('misc.timeHoursAgo', { n: h })
  const d = Math.round(h / 24)
  if (d < 7) return t('misc.timeDaysAgo', { n: d })
  const locale = currentLang() === 'zh' ? 'zh-CN' : 'en-US'
  return new Date(ts).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
}
