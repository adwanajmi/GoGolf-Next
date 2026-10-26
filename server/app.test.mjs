import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.mjs'
import { localDate, weekday } from './db.mjs'

function tomorrow() { const date = new Date(`${localDate()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0,10) }
async function setup() {
  const { server, db } = createApp({ database: ':memory:' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, method = 'GET', data, cookie) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) })
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const register = async (email, name = 'Golfer') => request('/auth/register', 'POST', { email, name, password: 'test-password-123' })
  return { db, request, register, close: async () => { await new Promise(resolve => server.close(resolve)); db.close() } }
}

test('KDE reference and course layout are served without a login', async () => {
  const app = await setup()
  try {
    const clubs = await app.request('/clubs')
    assert.equal(clubs.status, 200)
    assert.equal(clubs.data.clubs[0].name, 'Kelab Darul Ehsan')
    const course = await app.request('/courses/kde-main')
    assert.equal(course.data.course.layout_url, '/heritage/kde-course-layout.png')
    assert.equal(course.data.holes.length, 18)
    assert.equal(course.data.holes[0].blue_distance_m, 377)
  } finally { await app.close() }
})

test('registration is golfer-only and admin endpoints reject it', async () => {
  const app = await setup()
  try {
    const golfer = await app.register('one@example.test', 'One Golfer')
    assert.equal(golfer.status, 201)
    assert.equal(golfer.data.user.role, 'golfer')
    assert.equal((await app.request('/admin/overview', 'GET', undefined, golfer.cookie)).status, 403)
    assert.equal((await app.request('/me/bookings')).status, 401)
  } finally { await app.close() }
})

test('last-capacity race, failed retry, and duplicate success stay consistent', async () => {
  const app = await setup()
  try {
    const first = await app.register('first@example.test', 'First')
    const second = await app.register('second@example.test', 'Second')
    const date = tomorrow()
    const payload = { courseId: 'kde-main', date, hour: 8, players: 3 }
    const results = await Promise.all([
      app.request('/bookings', 'POST', { ...payload, idempotencyKey: 'first-attempt' }, first.cookie),
      app.request('/bookings', 'POST', { ...payload, idempotencyKey: 'second-attempt' }, second.cookie),
    ])
    assert.deepEqual(results.map(item => item.status).sort(), [201, 409])
    const winner = results.find(item => item.status === 201)
    const cookie = results[0].status === 201 ? first.cookie : second.cookie
    const bookingId = winner.data.booking.id
    assert.equal((await app.request(`/bookings/${bookingId}/payments/demo`, 'POST', { outcome: 'failed' }, cookie)).data.booking.payment_status, 'failed')
    const paid = await app.request(`/bookings/${bookingId}/payments/demo`, 'POST', { outcome: 'success' }, cookie)
    assert.equal(paid.data.booking.status, 'confirmed')
    const again = await app.request(`/bookings/${bookingId}/payments/demo`, 'POST', { outcome: 'success' }, cookie)
    assert.equal(again.data.booking.status, 'confirmed')
    const detail = await app.request(`/bookings/${bookingId}`, 'GET', undefined, cookie)
    assert.equal(detail.data.attempts.length, 2)
    assert.equal((await app.request(`/bookings/${bookingId}`, 'GET', undefined, results[0].status === 201 ? second.cookie : first.cookie)).status, 403)
  } finally { await app.close() }
})

test('expired hold and cancelled payment release the slot', async () => {
  const app = await setup()
  try {
    const golfer = await app.register('expiry@example.test')
    const date = tomorrow()
    const first = await app.request('/bookings', 'POST', { courseId:'kde-main', date, hour:10, players:4, idempotencyKey:'old-hold' }, golfer.cookie)
    assert.equal(first.status, 201)
    app.db.prepare('UPDATE bookings SET hold_expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', first.data.booking.id)
    const slots = await app.request(`/courses/kde-main/slots?date=${date}`)
    assert.equal(slots.data.slots.find(slot => slot.hour === 10).remaining, 4)
    const next = await app.request('/bookings', 'POST', { courseId:'kde-main', date, hour:10, players:4, idempotencyKey:'new-hold' }, golfer.cookie)
    assert.equal(next.status, 201)
    assert.equal((await app.request(`/bookings/${next.data.booking.id}/payments/demo`, 'POST', { outcome:'cancelled' }, golfer.cookie)).data.booking.status, 'cancelled')
    const after = await app.request(`/courses/kde-main/slots?date=${date}`)
    assert.equal(after.data.slots.find(slot => slot.hour === 10).remaining, 4)
  } finally { await app.close() }
})

test('admin schedule edits and blocks respect an active hold', async () => {
  const app = await setup()
  try {
    const golfer = await app.register('schedule-golfer@example.test')
    const admin = await app.register('schedule-admin@example.test')
    app.db.prepare("UPDATE users SET role='admin' WHERE email=?").run('schedule-admin@example.test')
    const date = tomorrow()
    const hold = await app.request('/bookings', 'POST', { courseId:'kde-main', date, hour:8, players:3, idempotencyKey:'schedule-hold' }, golfer.cookie)
    assert.equal(hold.status, 201)
    const schedule = { courseId:'kde-main', weekday:weekday(date), hour:8, capacity:2, basePriceCents:3500, active:true }
    assert.equal((await app.request('/admin/schedules', 'PUT', schedule, admin.cookie)).status, 409)
    assert.equal((await app.request('/admin/schedules', 'PUT', { ...schedule, capacity:3 }, admin.cookie)).status, 200)
    assert.equal((await app.request('/admin/blocks', 'POST', { courseId:'kde-main', date, hour:8, reason:'Test closure' }, admin.cookie)).status, 409)
    await app.request(`/bookings/${hold.data.booking.id}/payments/demo`, 'POST', { outcome:'cancelled' }, golfer.cookie)
    assert.equal((await app.request('/admin/blocks', 'POST', { courseId:'kde-main', date, hour:8, reason:'Test closure' }, admin.cookie)).status, 201)
  } finally { await app.close() }
})

test('club booking switch and cancellation window are applied by the server', async () => {
  const app = await setup()
  try {
    const golfer = await app.register('policy-golfer@example.test')
    const admin = await app.register('policy-admin@example.test')
    app.db.prepare("UPDATE users SET role='admin' WHERE email=?").run('policy-admin@example.test')
    const date = tomorrow()
    assert.equal((await app.request('/admin/clubs/kde', 'PATCH', { bookingEnabled:false, cancelHours:168 }, admin.cookie)).status, 200)
    assert.equal((await app.request(`/courses/kde-main/slots?date=${date}`)).data.slots.find(slot => slot.hour === 8).status, 'unavailable')
    assert.equal((await app.request('/bookings', 'POST', { courseId:'kde-main', date, hour:8, players:1, idempotencyKey:'disabled' }, golfer.cookie)).status, 409)
    assert.equal((await app.request('/admin/clubs/kde', 'PATCH', { bookingEnabled:true }, admin.cookie)).status, 200)
    const hold = await app.request('/bookings', 'POST', { courseId:'kde-main', date, hour:8, players:1, idempotencyKey:'enabled' }, golfer.cookie)
    assert.equal(hold.status, 201)
    await app.request(`/bookings/${hold.data.booking.id}/payments/demo`, 'POST', { outcome:'success' }, golfer.cookie)
    assert.equal((await app.request(`/bookings/${hold.data.booking.id}/cancel`, 'POST', {}, golfer.cookie)).status, 409)
    await app.request('/admin/clubs/kde', 'PATCH', { cancelHours:0 }, admin.cookie)
    assert.equal((await app.request(`/bookings/${hold.data.booking.id}/cancel`, 'POST', {}, golfer.cookie)).status, 200)
  } finally { await app.close() }
})

test('hole editing is protected, validated, and persists', async () => {
  const app = await setup()
  try {
    const golfer = await app.register('hole-golfer@example.test')
    const admin = await app.register('hole-admin@example.test')
    app.db.prepare("UPDATE users SET role='admin' WHERE email=?").run('hole-admin@example.test')
    const original = (await app.request('/courses/kde-main')).data.holes
    const holes = original.map((hole, index) => ({ par: index === 0 ? 5 : hole.par, distanceM: hole.blue_distance_m }))
    assert.equal((await app.request('/admin/courses/kde-main/holes', 'PUT', { holes }, golfer.cookie)).status, 403)
    assert.equal((await app.request('/admin/courses/kde-main/holes', 'PUT', { holes:holes.slice(0, 9) }, admin.cookie)).status, 400)
    assert.equal((await app.request('/admin/courses/kde-main/holes', 'PUT', { holes }, admin.cookie)).status, 200)
    assert.equal((await app.request('/courses/kde-main')).data.holes[0].par, 5)
    assert.equal(app.db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='holes_update'").get().count, 1)
  } finally { await app.close() }
})

test('new course without a layout has an honest empty layout and no tee times', async () => {
  const app = await setup()
  try {
    const admin = await app.register('new-course-admin@example.test')
    app.db.prepare("UPDATE users SET role='admin' WHERE email=?").run('new-course-admin@example.test')
    const invalid = await app.request('/admin/courses', 'POST', { clubId:'kde', name:'Invalid holes', description:'Test course', holes:10 }, admin.cookie)
    assert.equal(invalid.status, 400)
    const created = await app.request('/admin/courses', 'POST', { clubId:'kde', name:'Test nine', description:'Unconfigured test course', holes:9 }, admin.cookie)
    assert.equal(created.status, 201)
    const detail = await app.request(`/courses/${created.data.id}`)
    assert.equal(detail.data.course.layout_url, null)
    assert.equal(detail.data.holes.length, 0)
    assert.deepEqual((await app.request(`/courses/${created.data.id}/slots?date=${tomorrow()}`)).data.slots, [])
  } finally { await app.close() }
})

test('review and comment ownership plus auditable admin moderation', async () => {
  const app = await setup()
  try {
    const author = await app.register('author@example.test', 'Author')
    const other = await app.register('other@example.test', 'Other')
    const review = await app.request('/reviews', 'POST', { courseId:'kde-main', rating:4, title:'Course experience', body:'I played the front nine and enjoyed the layout.' }, author.cookie)
    assert.equal(review.status, 201)
    const reviewId = review.data.id
    assert.equal((await app.request(`/reviews/${reviewId}`, 'PATCH', { rating:1, title:'Changed', body:'Not mine' }, other.cookie)).status, 403)
    const comment = await app.request(`/reviews/${reviewId}/comments`, 'POST', { body:'Thanks for sharing.' }, other.cookie)
    assert.equal(comment.status, 201)
    assert.equal((await app.request(`/comments/${comment.data.id}`, 'DELETE', {}, author.cookie)).status, 403)
    app.db.prepare("UPDATE users SET role='admin' WHERE email=?").run('other@example.test')
    const moderation = await app.request(`/admin/reviews/${reviewId}/moderate`, 'POST', { status:'hidden', reason:'Test moderation' }, other.cookie)
    assert.equal(moderation.status, 200)
    assert.equal((await app.request('/courses/kde-main/reviews')).data.count, 0)
    assert.equal(app.db.prepare('SELECT COUNT(*) count FROM moderation_actions').get().count, 1)
  } finally { await app.close() }
})
