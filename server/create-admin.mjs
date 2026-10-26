import { createInterface } from 'node:readline/promises'
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { stdin as input, stdout as output } from 'node:process'
import { Writable } from 'node:stream'
import { openDatabase } from './db.mjs'

const db = openDatabase()
if (!input.isTTY) { console.error('Run this command in an interactive terminal so the password stays private.'); process.exit(1) }
let muted = false
const maskedOutput = new Writable({ write(chunk, encoding, done) { if (!muted) output.write(chunk); done() } })
const rl = createInterface({ input, output: maskedOutput, terminal: true })
try {
  const email = (await rl.question('Admin email: ')).trim().toLowerCase()
  const name = (await rl.question('Admin full name: ')).trim()
  output.write('Admin password (10+ characters; hidden): ')
  muted = true
  const password = await rl.question('')
  muted = false
  output.write('\n')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || password.length < 10) throw new Error('Valid email, name, and a 10+ character password are required')
  const existing = db.prepare('SELECT id,role FROM users WHERE email=?').get(email)
  if (existing) throw new Error('Account already exists; this command does not promote existing users')
  const salt = randomBytes(16).toString('hex')
  db.prepare('INSERT INTO users (id,email,password_hash,salt,name,role,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(randomUUID(), email, scryptSync(password, salt, 64).toString('hex'), salt, name, 'admin', new Date().toISOString())
  console.log('Admin account created in the separate GoGolf Next database.')
} catch (error) { muted = false; output.write('\n'); console.error(error.message); process.exitCode = 1 }
finally { rl.close(); db.close() }
