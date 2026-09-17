/** Demo-time formatting — fixed to the synthetic household timezone (EDT). */
const TZ = "America/New_York"
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })

export const formatTime = (ms: number): string => timeFmt.format(ms)
export const formatDay = (ms: number): string => dayFmt.format(ms)
export const formatDayTime = (ms: number): string => `${dayFmt.format(ms)}, ${timeFmt.format(ms)}`
