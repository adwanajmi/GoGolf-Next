import { createServer } from 'node:http'
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { openDatabase, transaction, row, rows, localDate, validDate, weekday, expireHolds } from './db.mjs'

const cookieName = 'gogolf_next_session'
const hash = value => createHash('sha256').update(value).digest('hex')
const id = () => randomUUID()
const now = () => new Date().toISOString()
const clean = value => typeof value === 'string' ? value.trim() : ''
const int = value => Number.isInteger(Number(value)) ? Number(value) : NaN
const publicUser = user => user && ({ id: user.id, email: user.email, name: user.name, phone: user.phone, avatarUrl: user.avatar_url, role: user.role, createdAt: user.created_at })

function fail(status, message) { const error = new Error(message); error.status = status; throw error }
function requireText(value, label, max = 500) { const text = clean(value); if (!text || text.length > max) fail(400, `${label} must be 1–${max} characters`); return text }
function requireInt(value, label, min, max) { const number = int(value); if (number < min || number > max || !Number.isFinite(number)) fail(400, `${label} must be ${min}–${max}`); return number }
function passHash(password, salt) { return scryptSync(password, salt, 64).toString('hex') }
function audit(db, user, action, type, target, detail = {}) {
  db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?)').run(id(), user?.id || null, action, type, String(target), JSON.stringify(detail), now())
}
function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end(JSON.stringify(payload))
}
async function body(req) {
  let input = ''
  for await (const chunk of req) { input += chunk; if (input.length > 3_000_000) fail(413, 'Request is too large') }
  if (!input) return {}
  try { return JSON.parse(input) } catch { fail(400, 'Invalid JSON') }
}
function actor(db, req) {
  const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  return row(db, `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, hash(token), now()) || null
}
function requireUser(user) { if (!user) fail(401, 'Sign in to continue'); return user }
function session(db, user, res) {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 86400_000).toISOString()
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(id(), user.id, hash(token), expires, now())
  res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`)
}
function courseRecord(db, courseId) {
  const course = row(db, `SELECT c.*, b.name club_name,b.state,b.city,b.timezone,b.status club_status,b.demo club_demo,b.cancel_hours,b.booking_enabled
    FROM courses c JOIN clubs b ON b.id=c.club_id WHERE c.id=?`, courseId)
  if (!course) fail(404, 'Course not found')
  return course
}
function bookingRecord(db, bookingId, user) {
  const booking = row(db, `SELECT b.*,c.name course_name,c.club_id,cl.name club_name FROM bookings b
    JOIN courses c ON c.id=b.course_id JOIN clubs cl ON cl.id=c.club_id WHERE b.id=?`, bookingId)
  if (!booking) fail(404, 'Booking not found')
  if (booking.user_id !== user.id && user.role !== 'admin') fail(403, 'Access denied')
  return booking
}
function slot(db, course, date, hour) {
  const schedule = row(db, 'SELECT * FROM schedules WHERE course_id=? AND weekday=? AND hour=?', course.id, weekday(date), hour)
  const blocked = row(db, 'SELECT reason FROM blocks WHERE course_id=? AND date=? AND hour=?', course.id, date, hour)
  const taken = row(db, `SELECT COALESCE(SUM(players),0) players FROM bookings
    WHERE course_id=? AND date=? AND hour=? AND status IN ('confirmed','awaiting_payment')`, course.id, date, hour).players
  const remaining = schedule ? Math.max(0, schedule.capacity - taken) : 0
  const status = !schedule || !schedule.active || course.status !== 'active' || course.club_status !== 'active' || !course.booking_enabled
    ? 'unavailable' : blocked ? 'blocked' : remaining === 0 ? 'full' : 'available'
  return { hour, status, capacity: schedule?.capacity || 0, remaining, priceCents: schedule?.base_price_cents ?? null, demo: !!schedule?.demo, reason: blocked?.reason || null }
}
function bookingView(db, userId = null) {
  const sql = `SELECT b.*,u.name golfer_name,u.email golfer_email,c.name course_name,cl.name club_name,cl.state,cl.city
    FROM bookings b JOIN users u ON u.id=b.user_id JOIN courses c ON c.id=b.course_id JOIN clubs cl ON cl.id=c.club_id`
  return userId ? rows(db, `${sql} WHERE b.user_id=? ORDER BY b.date DESC,b.hour DESC`, userId)
    : rows(db, `${sql} ORDER BY b.created_at DESC LIMIT 200`)
}
function bookingWindow(course, date) {
  if (!validDate(date)) fail(400, 'Choose a valid date')
  const day = localDate(course.timezone)
  const daysAhead = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400_000
  if (daysAhead < 1 || daysAhead > 14) fail(400, 'Bookings open from tomorrow through the next 14 days')
}
function reviewView(db, courseId, sort = 'newest', limit = 20, offset = 0) {
  const order = sort === 'rating' ? 'r.rating DESC,r.created_at DESC' : 'r.created_at DESC'
  const list = rows(db, `SELECT r.*,u.name author_name,
    CASE WHEN r.booking_id IS NOT NULL THEN 1 ELSE 0 END verified
    FROM reviews r JOIN users u ON u.id=r.user_id
    WHERE r.course_id=? AND r.status='published' ORDER BY ${order} LIMIT ? OFFSET ?`, courseId, limit, offset)
  return list.map(review => ({ ...review, comments: rows(db, `SELECT c.*,u.name author_name FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.review_id=? AND c.status='published' ORDER BY c.created_at ASC LIMIT 50`, review.id) }))
}

export function createApp({ database = process.env.GOGOLF_DB, staticDir = resolve('dist'), uploadDir = resolve('data/uploads') } = {}) {
  const db = openDatabase(database)
  const attempts = new Map()
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      const path = url.pathname
      if (!path.startsWith('/api/')) return serveFile(req, res, path, staticDir, uploadDir)
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin
        if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):(8200|8201|8202|8203)$/.test(origin)) fail(403, 'Origin denied')
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, 'JSON request required')
      }
      const user = actor(db, req)
      const input = req.method === 'GET' ? {} : await body(req)
      const match = expression => path.match(expression)
      const result = (status, data) => send(res, status, data)
      if (path === '/api/health' && req.method === 'GET') return result(200, { ok: true, database: true })
      if (path === '/api/auth/me' && req.method === 'GET') return result(200, { user: publicUser(user) })
      if (path === '/api/auth/register' && req.method === 'POST') {
        const email = requireText(input.email, 'Email', 254).toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email')
        const name = requireText(input.name, 'Name', 100)
        const password = String(input.password || '')
        if (password.length < 10 || password.length > 128) fail(400, 'Password must be 10–128 characters')
        if (row(db, 'SELECT id FROM users WHERE email=?', email)) fail(409, 'Email already registered')
        const salt = randomBytes(16).toString('hex')
        const idValue = id()
        db.prepare('INSERT INTO users (id,email,password_hash,salt,name,role,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(idValue, email, passHash(password, salt), salt, name, 'golfer', now())
        const account = row(db, 'SELECT * FROM users WHERE id=?', idValue)
        session(db, account, res)
        audit(db, account, 'register', 'user', idValue)
        return result(201, { user: publicUser(account) })
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'local'
        const recent = (attempts.get(ip) || []).filter(time => time > Date.now() - 300_000)
        if (recent.length >= 10) fail(429, 'Too many login attempts. Try later.')
        recent.push(Date.now()); attempts.set(ip, recent)
        const account = row(db, 'SELECT * FROM users WHERE email=?', clean(input.email).toLowerCase())
        const candidate = passHash(String(input.password || ''), account?.salt || 'invalid-salt')
        const correct = account && timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(account.password_hash, 'hex'))
        if (!correct) fail(401, 'Invalid email or password')
        attempts.delete(ip)
        session(db, account, res)
        return result(200, { user: publicUser(account) })
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token))
        res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
        return result(200, { ok: true })
      }
      if (path === '/api/me' && req.method === 'PATCH') {
        requireUser(user)
        const name = requireText(input.name, 'Name', 100)
        const phone = clean(input.phone)
        if (phone && !/^\+?[0-9 ()-]{7,25}$/.test(phone)) fail(400, 'Enter a valid phone number')
        const avatar = clean(input.avatarUrl)
        if (avatar && !avatar.startsWith('/uploads/')) fail(400, 'Upload a profile image first')
        db.prepare('UPDATE users SET name=?,phone=?,avatar_url=? WHERE id=?').run(name, phone || null, avatar || null, user.id)
        audit(db, user, 'profile_update', 'user', user.id)
        return result(200, { user: publicUser(row(db, 'SELECT * FROM users WHERE id=?', user.id)) })
      }
      if (path === '/api/uploads' && req.method === 'POST') {
        requireUser(user)
        const data = clean(input.dataUrl)
        const found = data.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
        if (!found) fail(400, 'Upload a PNG or JPEG image')
        const bytes = Buffer.from(found[2], 'base64')
        if (bytes.length < 10 || bytes.length > 2_000_000) fail(400, 'Image must be under 2 MB')
        const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        if ((found[1] === 'png' && !png) || (found[1] === 'jpeg' && !jpeg)) fail(400, 'Invalid image file')
        mkdirSync(uploadDir, { recursive: true })
        const filename = `${id()}.${png ? 'png' : 'jpg'}`
        writeFileSync(resolve(uploadDir, filename), bytes, { flag: 'wx' })
        return result(201, { url: `/uploads/${filename}` })
      }
      if (path === '/api/clubs' && req.method === 'GET') {
        const term = `%${clean(url.searchParams.get('q')).slice(0, 80)}%`
        const state = `%${clean(url.searchParams.get('state')).slice(0, 80)}%`
        return result(200, { clubs: rows(db, `SELECT cl.*,
          (SELECT COUNT(*) FROM courses co WHERE co.club_id=cl.id AND co.status='active') course_count,
          (SELECT ROUND(AVG(r.rating),1) FROM reviews r JOIN courses co ON co.id=r.course_id WHERE co.club_id=cl.id AND r.status='published') average_rating,
          (SELECT COUNT(*) FROM reviews r JOIN courses co ON co.id=r.course_id WHERE co.club_id=cl.id AND r.status='published') review_count
          FROM clubs cl WHERE cl.status='active' AND (cl.name LIKE ? OR cl.city LIKE ?) AND cl.state LIKE ? ORDER BY cl.name`, term, term, state) })
      }
      const clubMatch = match(/^\/api\/clubs\/([a-z0-9-]+)$/)
      if (clubMatch && req.method === 'GET') {
        const club = row(db, 'SELECT * FROM clubs WHERE id=? AND status=?', clubMatch[1], 'active')
        if (!club) fail(404, 'Club not found')
        const rating = row(db, `SELECT ROUND(AVG(r.rating),1) average_rating, COUNT(*) review_count
          FROM reviews r JOIN courses c ON c.id=r.course_id WHERE c.club_id=? AND r.status='published'`, club.id)
        return result(200, { club: { ...club, ...rating }, courses: rows(db, `SELECT c.*,
          (SELECT ROUND(AVG(rating),1) FROM reviews WHERE course_id=c.id AND status='published') average_rating,
          (SELECT COUNT(*) FROM reviews WHERE course_id=c.id AND status='published') review_count
          FROM courses c WHERE c.club_id=? AND c.status='active' ORDER BY c.name`, club.id) })
      }
      const courseMatch = match(/^\/api\/courses\/([a-z0-9-]+)$/)
      if (courseMatch && req.method === 'GET') {
        const course = courseRecord(db, courseMatch[1])
        return result(200, { course, holes: rows(db, 'SELECT * FROM holes WHERE course_id=? ORDER BY number', course.id),
          rating: row(db, `SELECT ROUND(AVG(rating),1) average,COUNT(*) count FROM reviews WHERE course_id=? AND status='published'`, course.id) })
      }
      const slotMatch = match(/^\/api\/courses\/([a-z0-9-]+)\/slots$/)
      if (slotMatch && req.method === 'GET') {
        const course = courseRecord(db, slotMatch[1]); const date = clean(url.searchParams.get('date'))
        bookingWindow(course, date); expireHolds(db)
        const hours = rows(db, 'SELECT hour FROM schedules WHERE course_id=? AND weekday=? ORDER BY hour', course.id, weekday(date))
        return result(200, { date, slots: hours.map(item => slot(db, course, date, item.hour)), currency: 'MYR' })
      }
      const reviewMatch = match(/^\/api\/courses\/([a-z0-9-]+)\/reviews$/)
      if (reviewMatch && req.method === 'GET') {
        courseRecord(db, reviewMatch[1])
        const count = row(db, `SELECT COUNT(*) count,ROUND(AVG(rating),1) average FROM reviews WHERE course_id=? AND status='published'`, reviewMatch[1])
        const offset = int(url.searchParams.get('offset') || 0)
        if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) fail(400, 'Invalid review page')
        return result(200, { ...count, reviews: reviewView(db, reviewMatch[1], url.searchParams.get('sort'), 20, offset) })
      }
      if (path === '/api/bookings' && req.method === 'POST') {
        requireUser(user)
        const course = courseRecord(db, clean(input.courseId))
        const date = clean(input.date); bookingWindow(course, date)
        const hour = requireInt(input.hour, 'Hour', 0, 23)
        const players = requireInt(input.players, 'Players', 1, 4)
        const key = requireText(input.idempotencyKey, 'Idempotency key', 120)
        const booking = transaction(db, () => {
          expireHolds(db)
          const prior = row(db, 'SELECT * FROM bookings WHERE user_id=? AND idempotency_key=?', user.id, key)
          if (prior) return prior
          const availability = slot(db, course, date, hour)
          if (availability.status !== 'available' || availability.remaining < players) fail(409, 'This tee time cannot fit your group')
          const hold = new Date(Date.now() + 15 * 60_000).toISOString()
          const bookingId = id(); const ref = `GG-${randomBytes(5).toString('hex').toUpperCase()}`
          db.prepare(`INSERT INTO bookings (id,ref,user_id,course_id,date,hour,players,holes,total_cents,status,payment_status,hold_expires_at,created_at,idempotency_key)
            VALUES (?,?,?,?,?,?,?,?,?,'awaiting_payment','pending',?,?,?)`)
            .run(bookingId, ref, user.id, course.id, date, hour, players, course.holes, availability.priceCents * players, hold, now(), key)
          audit(db, user, 'booking_hold', 'booking', bookingId, { date, hour, players })
          return row(db, 'SELECT * FROM bookings WHERE id=?', bookingId)
        })
        return result(201, { booking })
      }
      if (path === '/api/me/bookings' && req.method === 'GET') {
        requireUser(user); expireHolds(db); return result(200, { bookings: bookingView(db, user.id) })
      }
      const bookingMatch = match(/^\/api\/bookings\/([a-f0-9-]+)$/)
      if (bookingMatch && req.method === 'GET') {
        requireUser(user); expireHolds(db)
        const booking = bookingRecord(db, bookingMatch[1], user)
        return result(200, { booking, attempts: rows(db, 'SELECT * FROM payment_attempts WHERE booking_id=? ORDER BY created_at DESC', booking.id) })
      }
      const paymentMatch = match(/^\/api\/bookings\/([a-f0-9-]+)\/payments\/demo$/)
      if (paymentMatch && req.method === 'POST') {
        requireUser(user)
        const outcome = clean(input.outcome)
        if (!['success','failed','cancelled'].includes(outcome)) fail(400, 'Choose a demo payment outcome')
        const booking = transaction(db, () => {
          expireHolds(db)
          const current = bookingRecord(db, paymentMatch[1], user)
          if (current.status === 'confirmed' && outcome === 'success') return current
          if (current.status !== 'awaiting_payment') fail(409, 'This booking is no longer awaiting payment')
          const attemptId = id()
          db.prepare('INSERT INTO payment_attempts VALUES (?,?,?,?,?,?,?)')
            .run(attemptId, current.id, `DEMO-${randomBytes(6).toString('hex').toUpperCase()}`, 'demo', outcome, current.total_cents, now())
          const status = outcome === 'success' ? 'confirmed' : outcome === 'cancelled' ? 'cancelled' : 'awaiting_payment'
          const paymentStatus = outcome === 'success' ? 'paid' : outcome === 'cancelled' ? 'cancelled' : 'failed'
          db.prepare('UPDATE bookings SET status=?,payment_status=?,hold_expires_at=? WHERE id=?')
            .run(status, paymentStatus, outcome === 'cancelled' ? null : current.hold_expires_at, current.id)
          audit(db, user, `demo_payment_${outcome}`, 'booking', current.id, { attemptId })
          return row(db, 'SELECT * FROM bookings WHERE id=?', current.id)
        })
        return result(200, { booking })
      }
      const cancelMatch = match(/^\/api\/bookings\/([a-f0-9-]+)\/cancel$/)
      if (cancelMatch && req.method === 'POST') {
        requireUser(user)
        const booking = transaction(db, () => {
          expireHolds(db)
          const current = bookingRecord(db, cancelMatch[1], user)
          if (!['confirmed','awaiting_payment'].includes(current.status)) fail(409, 'Booking cannot be cancelled')
          const policy = row(db, `SELECT cl.cancel_hours FROM courses c JOIN clubs cl ON cl.id=c.club_id WHERE c.id=?`, current.course_id)
          const teeAt = Date.parse(`${current.date}T${String(current.hour).padStart(2, '0')}:00:00+08:00`)
          if (current.status === 'confirmed' && teeAt <= Date.now()) fail(409, 'This round has already started')
          if (current.status === 'confirmed' && teeAt - Date.now() < policy.cancel_hours * 3600_000) fail(409, `Cancellation closes ${policy.cancel_hours} hours before tee time`)
          db.prepare(`UPDATE bookings SET status='cancelled',payment_status=CASE WHEN payment_status='paid' THEN 'paid' ELSE 'cancelled' END,
            hold_expires_at=NULL,cancelled_at=? WHERE id=?`).run(now(), current.id)
          audit(db, user, 'booking_cancel', 'booking', current.id)
          return row(db, 'SELECT * FROM bookings WHERE id=?', current.id)
        })
        return result(200, { booking, refund: booking.payment_status === 'paid' ? 'Manual review required; no money was collected in demo mode' : null })
      }
      return await handleMore({ db, req, res, path, url, input, user, match, result, uploadDir })
    } catch (error) {
      send(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' })
      if (!error.status) console.error(error)
    }
  })
  return { server, db }
}

function serveFile(req, res, path, staticDir, uploadDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' })
  const base = path.startsWith('/uploads/') ? uploadDir : staticDir
  const suffix = path.startsWith('/uploads/') ? path.slice(9) : path === '/' ? 'index.html' : path.slice(1)
  const file = resolve(base, suffix)
  if (!file.startsWith(resolve(base) + sep) || !existsSync(file)) {
    if (!path.startsWith('/uploads/') && !extname(path)) return serveFile(req, res, '/index.html', staticDir, uploadDir)
    return send(res, 404, { error: 'File not found' })
  }
  const extension = extname(file)
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' }[extension] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' })
  res.end(readFileSync(file))
}

// Community and administration routes are separated to keep the booking transaction visible.
import { handleMore } from './more.mjs'
