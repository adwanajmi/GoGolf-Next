import { randomUUID } from 'node:crypto'
import { row, rows, transaction, validDate, localDate, expireHolds } from './db.mjs'

const id = () => randomUUID()
const now = () => new Date().toISOString()
const clean = value => typeof value === 'string' ? value.trim() : ''
const integer = value => Number.isInteger(Number(value)) ? Number(value) : NaN
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
const text = (value, label, max = 500) => { const result = clean(value); if (!result || result.length > max) fail(400, `${label} must be 1–${max} characters`); return result }
const number = (value, label, min, max) => { const result = integer(value); if (!Number.isFinite(result) || result < min || result > max) fail(400, `${label} must be ${min}–${max}`); return result }
const userOnly = user => { if (!user) fail(401, 'Sign in to continue') }
const adminOnly = user => { userOnly(user); if (user.role !== 'admin') fail(403, 'Admin access required') }
const audit = (db, user, action, type, target, detail = {}) => db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?)')
  .run(id(), user?.id || null, action, type, target, JSON.stringify(detail), now())
const slug = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const safeImage = value => { const image = clean(value); if (image && !/^\/(heritage|uploads)\/[a-zA-Z0-9_.-]+$/.test(image)) fail(400, 'Use an uploaded or preserved image'); return image || null }

export async function handleMore({ db, req, path, url, input, user, match, result }) {
  if (path === '/api/me/reviews' && req.method === 'GET') {
    userOnly(user)
    return result(200, { reviews: rows(db, `SELECT r.*,c.name course_name FROM reviews r JOIN courses c ON c.id=r.course_id
      WHERE r.user_id=? ORDER BY r.created_at DESC`, user.id) })
  }
  if (path === '/api/me/scores' && req.method === 'GET') {
    userOnly(user)
    return result(200, { scores: rows(db, `SELECT s.*,c.name course_name FROM scorecards s JOIN courses c ON c.id=s.course_id
      WHERE s.user_id=? ORDER BY s.date DESC`, user.id).map(score => ({ ...score, strokes: JSON.parse(score.strokes) })) })
  }
  if (path === '/api/me/scores' && req.method === 'POST') {
    userOnly(user)
    const course = row(db, 'SELECT * FROM courses WHERE id=?', clean(input.courseId))
    if (!course) fail(404, 'Course not found')
    if (!validDate(clean(input.date)) || input.date > localDate()) fail(400, 'Choose a past or current date')
    if (!Array.isArray(input.strokes) || input.strokes.length !== course.holes || input.strokes.some(value => !Number.isInteger(value) || value < 1 || value > 15)) fail(400, 'Enter a valid stroke count for each hole')
    const scoreId = id()
    db.prepare('INSERT INTO scorecards VALUES (?,?,?,?,?,?)').run(scoreId, user.id, course.id, input.date, JSON.stringify(input.strokes), now())
    return result(201, { id: scoreId })
  }
  if (path === '/api/reviews' && req.method === 'POST') {
    userOnly(user)
    const course = row(db, 'SELECT id FROM courses WHERE id=? AND status=?', clean(input.courseId), 'active')
    if (!course) fail(404, 'Course not found')
    const rating = number(input.rating, 'Rating', 1, 5)
    const title = text(input.title, 'Title', 100)
    const body = text(input.body, 'Review', 2000)
    const likes = clean(input.likes).slice(0, 500)
    const dislikes = clean(input.dislikes).slice(0, 500)
    let bookingId = null
    if (input.bookingId) {
      const booking = row(db, `SELECT * FROM bookings WHERE id=? AND user_id=? AND course_id=? AND status='confirmed' AND payment_status='paid' AND date<?`,
        clean(input.bookingId), user.id, course.id, localDate())
      if (!booking) fail(400, 'A verified review needs a completed booking')
      bookingId = booking.id
    }
    const reviewId = id(); const created = now()
    db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(reviewId, course.id, user.id, bookingId, rating, title, likes, dislikes, body, 'published', created, created)
    audit(db, user, 'review_create', 'review', reviewId)
    return result(201, { id: reviewId })
  }
  const reviewMatch = match(/^\/api\/reviews\/([a-f0-9-]+)$/)
  if (reviewMatch && ['PATCH','DELETE'].includes(req.method)) {
    userOnly(user)
    const review = row(db, 'SELECT * FROM reviews WHERE id=?', reviewMatch[1])
    if (!review) fail(404, 'Review not found')
    if (review.user_id !== user.id) fail(403, 'Only the author can change this review')
    if (req.method === 'DELETE') {
      transaction(db, () => { db.prepare('DELETE FROM comments WHERE review_id=?').run(review.id); db.prepare('DELETE FROM reviews WHERE id=?').run(review.id); audit(db, user, 'review_delete', 'review', review.id) })
      return result(200, { ok: true })
    }
    db.prepare('UPDATE reviews SET rating=?,title=?,likes=?,dislikes=?,body=?,updated_at=? WHERE id=?')
      .run(number(input.rating, 'Rating', 1, 5), text(input.title, 'Title', 100), clean(input.likes).slice(0, 500), clean(input.dislikes).slice(0, 500), text(input.body, 'Review', 2000), now(), review.id)
    audit(db, user, 'review_update', 'review', review.id)
    return result(200, { ok: true })
  }
  const commentCreate = match(/^\/api\/reviews\/([a-f0-9-]+)\/comments$/)
  if (commentCreate && req.method === 'POST') {
    userOnly(user)
    const review = row(db, 'SELECT id FROM reviews WHERE id=? AND status=?', commentCreate[1], 'published')
    if (!review) fail(404, 'Review not found')
    const commentId = id(); const created = now()
    db.prepare('INSERT INTO comments VALUES (?,?,?,?,?,?,?)').run(commentId, review.id, user.id, text(input.body, 'Comment', 800), 'published', created, created)
    audit(db, user, 'comment_create', 'comment', commentId)
    return result(201, { id: commentId })
  }
  const commentMatch = match(/^\/api\/comments\/([a-f0-9-]+)$/)
  if (commentMatch && ['PATCH','DELETE'].includes(req.method)) {
    userOnly(user)
    const comment = row(db, 'SELECT * FROM comments WHERE id=?', commentMatch[1])
    if (!comment) fail(404, 'Comment not found')
    if (comment.user_id !== user.id) fail(403, 'Only the author can change this comment')
    if (req.method === 'DELETE') db.prepare('DELETE FROM comments WHERE id=?').run(comment.id)
    else db.prepare('UPDATE comments SET body=?,updated_at=? WHERE id=?').run(text(input.body, 'Comment', 800), now(), comment.id)
    audit(db, user, req.method === 'DELETE' ? 'comment_delete' : 'comment_update', 'comment', comment.id)
    return result(200, { ok: true })
  }
  if (path === '/api/posts' && req.method === 'GET') return result(200, { posts: rows(db, `SELECT p.*,u.name author_name FROM posts p JOIN users u ON u.id=p.author_id ORDER BY p.created_at DESC LIMIT 50`) })
  if (!path.startsWith('/api/admin/')) fail(404, 'Endpoint not found')
  adminOnly(user)
  if (path === '/api/admin/overview' && req.method === 'GET') {
    expireHolds(db)
    const count = sql => row(db, sql).value
    return result(200, { metrics: {
      golfers: count("SELECT COUNT(*) value FROM users WHERE role='golfer'"),
      clubs: count('SELECT COUNT(*) value FROM clubs'),
      courses: count('SELECT COUNT(*) value FROM courses'),
      todayBookings: row(db, 'SELECT COUNT(*) value FROM bookings WHERE date=?', localDate()).value,
      upcomingBookings: row(db, `SELECT COUNT(*) value FROM bookings WHERE date>=? AND status='confirmed'`, localDate()).value,
      pendingPayments: count("SELECT COUNT(*) value FROM bookings WHERE status='awaiting_payment'"),
      cancelledBookings: count("SELECT COUNT(*) value FROM bookings WHERE status='cancelled'"),
      demoPaidCents: count("SELECT COALESCE(SUM(total_cents),0) value FROM bookings WHERE payment_status='paid'")
    }, recentBookings: rows(db, `SELECT b.*,u.name golfer_name,c.name course_name FROM bookings b JOIN users u ON u.id=b.user_id JOIN courses c ON c.id=b.course_id ORDER BY b.created_at DESC LIMIT 8`) })
  }
  if (path === '/api/admin/users' && req.method === 'GET') return result(200, { users: rows(db, `SELECT u.id,u.email,u.name,u.phone,u.role,u.created_at,COUNT(b.id) booking_count FROM users u LEFT JOIN bookings b ON b.user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200`) })
  if (path === '/api/admin/bookings' && req.method === 'GET') {
    expireHolds(db)
    const all = rows(db, `SELECT b.*,u.name golfer_name,u.email golfer_email,c.name course_name,cl.name club_name,cl.id club_id FROM bookings b
      JOIN users u ON u.id=b.user_id JOIN courses c ON c.id=b.course_id JOIN clubs cl ON cl.id=c.club_id ORDER BY b.created_at DESC LIMIT 300`)
    const query = clean(url.searchParams.get('q')).toLowerCase()
    const status = clean(url.searchParams.get('status'))
    const date = clean(url.searchParams.get('date'))
    if (date && !validDate(date)) fail(400, 'Invalid booking date')
    const clubId = clean(url.searchParams.get('clubId'))
    const courseId = clean(url.searchParams.get('courseId'))
    return result(200, { bookings: all.filter(item => (!status || item.status === status) && (!date || item.date === date) && (!clubId || item.club_id === clubId) && (!courseId || item.course_id === courseId) && (!query || [item.ref,item.golfer_name,item.golfer_email,item.course_name,item.club_name].some(value => value.toLowerCase().includes(query)))) })
  }
  if (path === '/api/admin/payments' && req.method === 'GET') {
    const status = clean(url.searchParams.get('status'))
    const date = clean(url.searchParams.get('date'))
    if (date && !validDate(date)) fail(400, 'Invalid payment date')
    const payments = rows(db, `SELECT p.*,b.ref booking_ref,u.email golfer_email FROM payment_attempts p JOIN bookings b ON b.id=p.booking_id JOIN users u ON u.id=b.user_id ORDER BY p.created_at DESC LIMIT 300`)
    return result(200, { payments: payments.filter(item => (!status || item.outcome === status) && (!date || item.created_at.startsWith(date))) })
  }
  if (path === '/api/admin/audit' && req.method === 'GET') return result(200, { actions: rows(db, `SELECT a.*,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 200`) })
  if (path === '/api/admin/clubs' && req.method === 'GET') return result(200, { clubs: rows(db, 'SELECT * FROM clubs ORDER BY name') })
  if (path === '/api/admin/courses' && req.method === 'GET') return result(200, { courses: rows(db, 'SELECT * FROM courses ORDER BY name') })
  if (path === '/api/admin/schedules' && req.method === 'GET') return result(200, { schedules: rows(db, 'SELECT * FROM schedules WHERE course_id=? ORDER BY weekday,hour', clean(url.searchParams.get('courseId'))), blocks: rows(db, 'SELECT * FROM blocks WHERE course_id=? AND date>=? ORDER BY date,hour LIMIT 100', clean(url.searchParams.get('courseId')), localDate()) })
  if (path === '/api/admin/reviews' && req.method === 'GET') return result(200, { reviews: rows(db, `SELECT r.*,u.name author_name,c.name course_name FROM reviews r JOIN users u ON u.id=r.user_id JOIN courses c ON c.id=r.course_id ORDER BY r.created_at DESC LIMIT 200`), comments: rows(db, `SELECT c.*,u.name author_name FROM comments c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 200`) })
  if (path === '/api/admin/clubs' && req.method === 'POST') {
    const name = text(input.name, 'Club name', 120); const clubId = `${slug(name)}-${id().slice(0, 6)}`
    const status = input.status === 'inactive' ? 'inactive' : 'active'
    db.prepare(`INSERT INTO clubs (id,name,state,city,description,image_url,facilities,timezone,status,demo,created_at,operating_info,contact_info,cancel_hours,booking_enabled)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(clubId, name, text(input.state, 'State', 80), text(input.city, 'City', 80), text(input.description, 'Description', 3000), safeImage(input.imageUrl), JSON.stringify(Array.isArray(input.facilities) ? input.facilities.map(clean).filter(Boolean).slice(0, 20) : []), 'Asia/Kuala_Lumpur', status, 1, now(), clean(input.operatingInfo).slice(0, 500) || null, clean(input.contactInfo).slice(0, 500) || null, number(input.cancelHours ?? 24, 'Cancellation window', 0, 168), input.bookingEnabled === false ? 0 : 1)
    audit(db, user, 'club_create', 'club', clubId)
    return result(201, { id: clubId })
  }
  const clubMatch = match(/^\/api\/admin\/clubs\/([a-z0-9-]+)$/)
  if (clubMatch && req.method === 'PATCH') {
    const club = row(db, 'SELECT * FROM clubs WHERE id=?', clubMatch[1]); if (!club) fail(404, 'Club not found')
    const status = ['active','inactive'].includes(input.status) ? input.status : club.status
    db.prepare('UPDATE clubs SET name=?,state=?,city=?,description=?,image_url=?,facilities=?,status=?,operating_info=?,contact_info=?,cancel_hours=?,booking_enabled=? WHERE id=?')
      .run(text(input.name ?? club.name, 'Club name', 120), text(input.state ?? club.state, 'State', 80), text(input.city ?? club.city, 'City', 80), text(input.description ?? club.description, 'Description', 3000), safeImage(input.imageUrl ?? club.image_url), JSON.stringify(Array.isArray(input.facilities) ? input.facilities.map(clean).filter(Boolean).slice(0, 20) : JSON.parse(club.facilities)), status, clean(input.operatingInfo ?? club.operating_info).slice(0, 500) || null, clean(input.contactInfo ?? club.contact_info).slice(0, 500) || null, number(input.cancelHours ?? club.cancel_hours, 'Cancellation window', 0, 168), input.bookingEnabled === undefined ? club.booking_enabled : input.bookingEnabled === false ? 0 : 1, club.id)
    audit(db, user, 'club_update', 'club', club.id)
    return result(200, { ok: true })
  }
  if (path === '/api/admin/courses' && req.method === 'POST') {
    const club = row(db, 'SELECT id FROM clubs WHERE id=?', clean(input.clubId)); if (!club) fail(404, 'Club not found')
    const name = text(input.name, 'Course name', 120); const courseId = `${slug(name)}-${id().slice(0, 6)}`
    const holeCount = number(input.holes, 'Holes', 9, 18)
    if (![9, 18].includes(holeCount)) fail(400, 'Course must have 9 or 18 holes')
    db.prepare('INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(courseId, club.id, name, text(input.description, 'Description', 3000), safeImage(input.layoutUrl), safeImage(input.imageUrl), holeCount, input.par ? number(input.par, 'Par', 20, 150) : null, input.distanceM ? number(input.distanceM, 'Distance', 100, 15000) : null, input.status === 'inactive' ? 'inactive' : 'active', 1, now())
    audit(db, user, 'course_create', 'course', courseId)
    return result(201, { id: courseId })
  }
  const courseMatch = match(/^\/api\/admin\/courses\/([a-z0-9-]+)$/)
  if (courseMatch && req.method === 'PATCH') {
    const course = row(db, 'SELECT * FROM courses WHERE id=?', courseMatch[1]); if (!course) fail(404, 'Course not found')
    const status = ['active','inactive'].includes(input.status) ? input.status : course.status
    const holeCount = input.holes ? number(input.holes, 'Holes', 9, 18) : course.holes
    if (![9, 18].includes(holeCount)) fail(400, 'Course must have 9 or 18 holes')
    transaction(db, () => {
      db.prepare('UPDATE courses SET name=?,description=?,layout_url=?,image_url=?,holes=?,par=?,distance_m=?,status=? WHERE id=?')
        .run(text(input.name ?? course.name, 'Course name', 120), text(input.description ?? course.description, 'Description', 3000), safeImage(input.layoutUrl ?? course.layout_url), safeImage(input.imageUrl ?? course.image_url), holeCount, input.par === '' ? null : input.par ? number(input.par, 'Par', 20, 150) : course.par, input.distanceM === '' ? null : input.distanceM ? number(input.distanceM, 'Distance', 100, 15000) : course.distance_m, status, course.id)
      db.prepare('DELETE FROM holes WHERE course_id=? AND number>?').run(course.id, holeCount)
      audit(db, user, 'course_update', 'course', course.id)
    })
    return result(200, { ok: true })
  }
  const holesMatch = match(/^\/api\/admin\/courses\/([a-z0-9-]+)\/holes$/)
  if (holesMatch && req.method === 'PUT') {
    const course = row(db, 'SELECT id,holes FROM courses WHERE id=?', holesMatch[1]); if (!course) fail(404, 'Course not found')
    if (!Array.isArray(input.holes) || input.holes.length !== course.holes) fail(400, `Enter all ${course.holes} holes`)
    const holes = input.holes.map((item, index) => ({
      number: index + 1,
      par: number(item.par, `Hole ${index + 1} par`, 3, 6),
      distance: item.distanceM === '' || item.distanceM == null ? null : number(item.distanceM, `Hole ${index + 1} blue tee distance`, 1, 1000),
    }))
    transaction(db, () => {
      db.prepare('DELETE FROM holes WHERE course_id=?').run(course.id)
      const insert = db.prepare('INSERT INTO holes (course_id,number,par,blue_distance_m) VALUES (?,?,?,?)')
      for (const hole of holes) insert.run(course.id, hole.number, hole.par, hole.distance)
      audit(db, user, 'holes_update', 'course', course.id, { count: holes.length })
    })
    return result(200, { ok: true })
  }
  if (path === '/api/admin/schedules' && req.method === 'PUT') {
    const course = row(db, 'SELECT id FROM courses WHERE id=?', clean(input.courseId)); if (!course) fail(404, 'Course not found')
    const day = number(input.weekday, 'Weekday', 0, 6); const hour = number(input.hour, 'Hour', 0, 23)
    const capacity = number(input.capacity, 'Capacity', 1, 40); const price = number(input.basePriceCents, 'Price', 0, 1_000_000)
    const active = input.active === false ? 0 : 1
    expireHolds(db)
    const occupied = row(db, `SELECT MAX(players) maximum FROM (
      SELECT date,SUM(players) players FROM bookings
      WHERE course_id=? AND date>=? AND hour=? AND CAST(strftime('%w',date) AS INTEGER)=?
        AND status IN ('confirmed','awaiting_payment') GROUP BY date)`, course.id, localDate(), hour, day)
    if (occupied.maximum && (capacity < occupied.maximum || !active)) fail(409, 'Existing bookings need this slot and capacity')
    db.prepare(`INSERT INTO schedules (course_id,weekday,hour,capacity,base_price_cents,active,demo) VALUES (?,?,?,?,?,?,1)
      ON CONFLICT(course_id,weekday,hour) DO UPDATE SET capacity=excluded.capacity,base_price_cents=excluded.base_price_cents,active=excluded.active`)
      .run(course.id, day, hour, capacity, price, active)
    audit(db, user, 'schedule_upsert', 'course', course.id, { day, hour, capacity, price, active })
    return result(200, { ok: true })
  }
  if (path === '/api/admin/blocks' && req.method === 'POST') {
    const course = row(db, 'SELECT id FROM courses WHERE id=?', clean(input.courseId)); if (!course) fail(404, 'Course not found')
    const date = clean(input.date); if (!validDate(date) || date < localDate()) fail(400, 'Choose a current or future date')
    const hour = number(input.hour, 'Hour', 0, 23)
    const reason = text(input.reason, 'Reason', 200)
    expireHolds(db)
    const active = row(db, `SELECT COALESCE(SUM(players),0) players FROM bookings WHERE course_id=? AND date=? AND hour=? AND status IN ('confirmed','awaiting_payment')`, course.id, date, hour)
    if (active.players) fail(409, 'Cannot block a slot with an active booking')
    db.prepare('INSERT OR IGNORE INTO blocks VALUES (?,?,?,?,?)').run(id(), course.id, date, hour, reason)
    audit(db, user, 'slot_block', 'course', course.id, { date, hour })
    return result(201, { ok: true })
  }
  const blockMatch = match(/^\/api\/admin\/blocks\/([a-f0-9-]+)$/)
  if (blockMatch && req.method === 'DELETE') {
    db.prepare('DELETE FROM blocks WHERE id=?').run(blockMatch[1])
    audit(db, user, 'slot_unblock', 'block', blockMatch[1])
    return result(200, { ok: true })
  }
  const moderateMatch = match(/^\/api\/admin\/(reviews|comments)\/([a-f0-9-]+)\/moderate$/)
  if (moderateMatch && req.method === 'POST') {
    const table = moderateMatch[1]; const target = row(db, `SELECT * FROM ${table} WHERE id=?`, moderateMatch[2])
    if (!target) fail(404, 'Content not found')
    const status = input.status === 'hidden' ? 'hidden' : input.status === 'published' ? 'published' : fail(400, 'Choose published or hidden')
    const reason = text(input.reason, 'Reason', 500)
    transaction(db, () => {
      db.prepare(`UPDATE ${table} SET status=? WHERE id=?`).run(status, target.id)
      db.prepare('INSERT INTO moderation_actions VALUES (?,?,?,?,?,?,?)').run(id(), user.id, table.slice(0, -1), target.id, status, reason, now())
      audit(db, user, 'moderation', table.slice(0, -1), target.id, { status, reason })
    })
    return result(200, { ok: true })
  }
  if (path === '/api/admin/posts' && req.method === 'POST') {
    const postId = id(); db.prepare('INSERT INTO posts VALUES (?,?,?,?,?)').run(postId, user.id, text(input.title, 'Title', 120), text(input.body, 'Post', 3000), now())
    audit(db, user, 'post_create', 'post', postId)
    return result(201, { id: postId })
  }
  const adminBooking = match(/^\/api\/admin\/bookings\/([a-f0-9-]+)\/cancel$/)
  if (adminBooking && req.method === 'POST') {
    const reason = text(input.reason, 'Reason', 500)
    const booking = row(db, 'SELECT * FROM bookings WHERE id=?', adminBooking[1]); if (!booking) fail(404, 'Booking not found')
    if (!['confirmed','awaiting_payment'].includes(booking.status)) fail(409, 'Booking is not active')
    db.prepare(`UPDATE bookings SET status='cancelled',payment_status=CASE WHEN payment_status='paid' THEN 'paid' ELSE 'cancelled' END,
      cancelled_at=?,hold_expires_at=NULL WHERE id=?`).run(now(), booking.id)
    audit(db, user, 'admin_booking_cancel', 'booking', booking.id, { reason })
    return result(200, { ok: true })
  }
  fail(404, 'Endpoint not found')
}
