export const TEE_HOURS = [8, 10, 12, 14, 16, 18] as const
export type TeeHour = (typeof TEE_HOURS)[number]
export type Holes = 9 | 18
export type Page = 'overview' | 'book' | 'bookings' | 'scores' | 'journal' | 'admin'

export interface Booking {
  id: string
  date: string
  hour: TeeHour
  holes: Holes
  players: number
  total: number
  status: 'confirmed' | 'cancelled' | 'completed'
  createdAt: string
}

export interface Scorecard {
  id: string
  date: string
  holes: Holes
  strokes: number[]
  course: string
}

export interface JournalPost {
  id: string
  category: string
  title: string
  body: string
  date: string
}

export interface AppData {
  bookings: Booking[]
  scores: Scorecard[]
  posts: JournalPost[]
  prices: Record<TeeHour, number>
  blockedSlots: string[]
}

export const slotKey = (date: string, hour: TeeHour) => `${date}|${hour}`

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

export function formatDate(key: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${key}T12:00:00`)
  return new Intl.DateTimeFormat('en-MY', options ?? { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function formatTime(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 || 12
  return `${display}:00 ${suffix}`
}

export function priceFor(prices: AppData['prices'], hour: TeeHour, holes: Holes, players: number): number {
  return prices[hour] * (holes / 9) * players
}

export function isSlotAvailable(data: AppData, date: string, hour: TeeHour): boolean {
  return !data.blockedSlots.includes(slotKey(date, hour)) &&
    !data.bookings.some(booking => booking.date === date && booking.hour === hour && booking.status === 'confirmed')
}

export function createDemoData(): AppData {
  return {
    prices: { 8: 45, 10: 50, 12: 55, 14: 55, 16: 50, 18: 40 },
    blockedSlots: [slotKey(dateOffset(3), 12)],
    bookings: [
      { id: 'demo-booking-1', date: dateOffset(2), hour: 8, holes: 18, players: 2, total: 180, status: 'confirmed', createdAt: new Date().toISOString() },
      { id: 'demo-booking-2', date: dateOffset(-5), hour: 14, holes: 9, players: 1, total: 55, status: 'completed', createdAt: new Date().toISOString() },
    ],
    scores: [
      { id: 'demo-score-1', date: dateOffset(-5), holes: 9, course: 'GoGolf Course', strokes: [5, 4, 6, 4, 5, 4, 5, 4, 5] },
      { id: 'demo-score-2', date: dateOffset(-14), holes: 18, course: 'GoGolf Course', strokes: [4, 5, 5, 4, 4, 6, 4, 5, 4, 5, 4, 5, 4, 6, 4, 5, 4, 5] },
    ],
    posts: [
      { id: 'demo-post-1', category: 'Club notes', title: 'A better way to plan your next round', body: 'This new GoGolf demo keeps availability, price, and booking details in one clear place. Pick a date, choose your round, and confirm your tee time.', date: dateOffset(-1) },
      { id: 'demo-post-2', category: 'Course guide', title: 'First nine or full eighteen?', body: 'A nine hole round is a good fit for a shorter visit. Choose eighteen when you have time for the complete course. Pricing is shown before you confirm.', date: dateOffset(-4) },
      { id: 'demo-post-3', category: 'Demo notice', title: 'Explore freely', body: 'Every booking and score in this prototype is stored only in your browser. No real reservations or payments are made.', date: dateOffset(-6) },
    ],
  }
}
