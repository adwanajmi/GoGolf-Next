import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const defaultPath = resolve('data/gogolf-next.sqlite')

export function openDatabase(path = process.env.GOGOLF_DB || defaultPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path, { timeout: 5000 })
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version))
  for (const version of [1, 2]) {
    if (applied.has(version)) continue
    const sql = readFileSync(new URL(`./migrations/${String(version).padStart(3, '0')}.sql`, import.meta.url), 'utf8')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(version, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  seedHeritage(db)
  return db
}

function seedHeritage(db) {
  const now = new Date().toISOString()
  db.prepare(`INSERT OR IGNORE INTO clubs (id,name,state,city,description,image_url,facilities,timezone,status,demo,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('kde', 'Kelab Darul Ehsan', 'Selangor', 'Petaling Jaya',
    'The original club featured in the GoGolf Final Year Project. Course photograph and layout are preserved from the historical project.',
    '/heritage/kde-course.jpg', '[]', 'Asia/Kuala_Lumpur', 'active', 1, now)
  db.prepare(`INSERT OR IGNORE INTO courses (id,club_id,name,description,layout_url,image_url,holes,par,distance_m,status,demo,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('kde-main', 'kde', 'KDE 18-hole course',
    'Original GoGolf FYP course layout, including hole drawings, par and blue tee distances.',
    '/heritage/kde-course-layout.png', '/heritage/kde-course.jpg', 18, 72, null, 'active', 1, now)
  const holeData = [[4,377],[3,128],[4,302],[3,110],[5,454],[5,494],[4,338],[3,128],[5,431],
    [4,395],[3,112],[4,315],[3,86],[5,472],[5,474],[4,353],[3,159],[5,439]]
  const insertHole = db.prepare('INSERT OR IGNORE INTO holes (course_id,number,par,blue_distance_m) VALUES (?,?,?,?)')
  holeData.forEach(([par, distance], index) => insertHole.run('kde-main', index + 1, par, distance))
  const prices = [[8, 35], [10, 35], [12, 45], [14, 45], [16, 45], [18, 50]]
  const insert = db.prepare(`INSERT OR IGNORE INTO schedules (course_id,weekday,hour,capacity,base_price_cents,active,demo)
    VALUES ('kde-main',?,?,?,?,1,1)`)
  for (let day = 0; day < 7; day++) for (const [hour, price] of prices) insert.run(day, hour, 4, price * 100)
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const result = fn(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}

export function row(db, sql, ...params) { return db.prepare(sql).get(...params) }
export function rows(db, sql, ...params) { return db.prepare(sql).all(...params) }

export function localDate(timezone = 'Asia/Kuala_Lumpur') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = type => parts.find(value => value.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function weekday(value) { return new Date(`${value}T12:00:00Z`).getUTCDay() }

export function expireHolds(db) {
  db.prepare(`UPDATE bookings SET status='expired',payment_status='expired',hold_expires_at=NULL
    WHERE status='awaiting_payment' AND hold_expires_at <= ?`).run(new Date().toISOString())
}
