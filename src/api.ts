export type User = { id: string; email: string; name: string; phone: string | null; avatarUrl: string | null; role: 'golfer' | 'admin'; createdAt: string }
export type Club = { id: string; name: string; state: string; city: string; description: string; image_url: string | null; facilities: string; timezone: string; status: string; demo: number; operating_info: string | null; contact_info: string | null; cancel_hours: number; booking_enabled: number; course_count?: number; average_rating?: number | null; review_count?: number }
export type Course = { id: string; club_id: string; club_name?: string; state?: string; city?: string; name: string; description: string; layout_url: string | null; image_url: string | null; holes: number; par: number | null; distance_m: number | null; status: string; demo: number; booking_enabled?: number; cancel_hours?: number; average_rating?: number | null; review_count?: number }
export type Hole = { course_id: string; number: number; par: number; blue_distance_m: number | null }
export type Slot = { hour: number; status: 'available' | 'full' | 'blocked' | 'unavailable'; capacity: number; remaining: number; priceCents: number | null; demo: boolean; reason: string | null }
export type Booking = { id: string; ref: string; user_id: string; course_id: string; date: string; hour: number; players: number; holes: number; total_cents: number; status: 'awaiting_payment' | 'confirmed' | 'cancelled' | 'expired'; payment_status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired'; hold_expires_at: string | null; created_at: string; course_name?: string; club_name?: string; golfer_name?: string; golfer_email?: string }
export type Review = { id: string; course_id: string; user_id: string; booking_id: string | null; rating: number; title: string; likes: string; dislikes: string; body: string; status: string; created_at: string; author_name?: string; course_name?: string; verified?: number; comments?: Comment[] }
export type Comment = { id: string; review_id: string; user_id: string; body: string; status: string; created_at: string; author_name?: string }
export type Score = { id: string; course_id: string; course_name: string; date: string; strokes: number[] }
export type Post = { id: string; title: string; body: string; created_at: string; author_name: string }

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch { throw new Error('Cannot reach the GoGolf server. Start the API with npm run api.') }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`)
  return payload as T
}

export const money = (cents: number) => `RM ${(cents / 100).toFixed(2)}`
export const timeLabel = (hour: number) => `${hour % 12 || 12}:00 ${hour >= 12 ? 'PM' : 'AM'}`
export const dateLabel = (date: string) => new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
export const todayKey = () => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const part = (type: string) => parts.find(item => item.type === type)?.value; return `${part('year')}-${part('month')}-${part('day')}` }
export function datePlus(days: number) { const date = new Date(`${todayKey()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
