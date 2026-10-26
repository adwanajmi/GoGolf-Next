import { randomUUID } from 'node:crypto'
import { openDatabase, transaction } from './db.mjs'

const email = (process.argv[2] || '').trim().toLowerCase()
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run admin:grant -- person@example.com')
  process.exit(1)
}

const db = openDatabase()
try {
  transaction(db, () => {
    const user = db.prepare('SELECT id,role FROM users WHERE email=?').get(email)
    if (!user) throw new Error('Account not found. Register in GoGolf Next first.')
    if (user.role === 'admin') throw new Error('This account is already an administrator.')
    db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id)
    db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?)').run(randomUUID(), null, 'local_admin_grant', 'user', user.id, JSON.stringify({ email }), new Date().toISOString())
  })
  console.log(`Admin access granted to ${email} in the separate GoGolf Next database.`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { db.close() }
