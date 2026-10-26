CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, salt TEXT NOT NULL,
  name TEXT NOT NULL, phone TEXT, avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'golfer' CHECK(role IN ('golfer','admin')),
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE clubs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, city TEXT NOT NULL,
  description TEXT NOT NULL, image_url TEXT, facilities TEXT NOT NULL DEFAULT '[]',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX clubs_place ON clubs(state,city);
CREATE TABLE courses (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), name TEXT NOT NULL,
  description TEXT NOT NULL, layout_url TEXT, image_url TEXT,
  holes INTEGER NOT NULL CHECK(holes IN (9,18)), par INTEGER, distance_m INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX courses_club ON courses(club_id);
CREATE TABLE holes (
  course_id TEXT NOT NULL REFERENCES courses(id), number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 36),
  par INTEGER NOT NULL CHECK(par BETWEEN 3 AND 6), blue_distance_m INTEGER,
  PRIMARY KEY(course_id,number)
);
CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id TEXT NOT NULL REFERENCES courses(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 40),
  base_price_cents INTEGER NOT NULL CHECK(base_price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE(course_id,weekday,hour)
);
CREATE TABLE blocks (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id),
  date TEXT NOT NULL, hour INTEGER NOT NULL, reason TEXT NOT NULL,
  UNIQUE(course_id,date,hour)
);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id), course_id TEXT NOT NULL REFERENCES courses(id),
  date TEXT NOT NULL, hour INTEGER NOT NULL, players INTEGER NOT NULL CHECK(players BETWEEN 1 AND 4),
  holes INTEGER NOT NULL, total_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('awaiting_payment','confirmed','cancelled','expired')),
  payment_status TEXT NOT NULL CHECK(payment_status IN ('pending','paid','failed','cancelled','expired')),
  hold_expires_at TEXT, created_at TEXT NOT NULL, cancelled_at TEXT,
  idempotency_key TEXT NOT NULL,
  UNIQUE(user_id,idempotency_key)
);
CREATE INDEX bookings_slot ON bookings(course_id,date,hour,status);
CREATE INDEX bookings_user ON bookings(user_id,date);
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
  ref TEXT NOT NULL UNIQUE, mode TEXT NOT NULL CHECK(mode='demo'),
  outcome TEXT NOT NULL CHECK(outcome IN ('success','failed','cancelled')),
  amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX payments_booking ON payment_attempts(booking_id);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id),
  user_id TEXT NOT NULL REFERENCES users(id), booking_id TEXT REFERENCES bookings(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title TEXT NOT NULL, likes TEXT NOT NULL DEFAULT '', dislikes TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX reviews_course ON reviews(course_id,status,created_at);
CREATE TABLE comments (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id),
  user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX comments_review ON comments(review_id,status,created_at);
CREATE TABLE moderation_actions (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('review','comment')),
  target_id TEXT NOT NULL, action TEXT NOT NULL,
  reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX audit_created ON audit_logs(created_at);
CREATE TABLE scorecards (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id), date TEXT NOT NULL,
  strokes TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE posts (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
