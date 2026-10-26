# GoGolf Next

A separate local rebuild of the GoGolf final year project, centred on Kelab Darul Ehsan (KDE). The historical `Gogolf-revival` checkout and its Firebase project are not changed. See [AUDIT.md](AUDIT.md) for the source audit and what was carried forward.

## Run locally

Requires Node.js 24. Keep both commands running in separate terminals:

```powershell
cd GoGolf-Next
npm install
npm run api
```

```powershell
cd GoGolf-Next
npm run dev -- --host 127.0.0.1 --port 8200
```

Open [http://127.0.0.1:8200/](http://127.0.0.1:8200/). The API listens on `127.0.0.1:8201`; Vite proxies `/api` and `/uploads` to it. `npm run build` checks the TypeScript and production bundle, `npm run test:api` runs isolated in-memory API tests, and `npm run lint` checks source lint. The SQLite file and uploads live in ignored `data/`.

## First accounts

Create a golfer account from **Sign in → Create an account**. These accounts belong only to GoGolf Next; the old Firebase account does not sign in here. To create the first administrator, run `npm run admin:create` in an interactive terminal and enter a new email, name, and hidden password. The terminal stays on your computer. If a golfer account already exists and should become an admin, use the trusted local `admin:grant` command described below.

## What to explore

- **Clubs and courses:** Search by name/city/state, open KDE, zoom its preserved 18-hole diagram, and inspect the historical hole pars and blue tee distances.
- **Tee times:** Pick a date in the next 14 days, slot, and 1–4 players. The server calculates price, checks saved capacity, and creates a 15-minute hold. Demo checkout supports success, failure, cancellation, and retry. Booking history and cancellation are saved.
- **Community:** Write a rating, likes, dislikes, and review; comment on reviews; edit or delete your own content. A completed paid demo booking can be linked to display a verified-round label. Admin moderation can hide or restore content.
- **Profile:** Edit name/phone/photo, see bookings and reviews, save scorecards, and read admin-published club notes.
- **Admin:** View counts, manage clubs/courses, layout images and hole details, weekly schedule and price, date blocks, booking availability and cancellation policy, bookings, users, demo payment attempts, reviews/comments, notes, and audit history. Server routes enforce roles.

Walkthrough captures are in [`screenshots/`](screenshots/): KDE discovery, the full course layout, a confirmed demo checkout, and the admin overview. The checkout and admin captures use an isolated synthetic test database; those test accounts are absent from the normal local database.

Only KDE is seeded. Historical course imagery/layout/hole information is identified as such. New tee times and prices are **demonstration data**. No user, booking, review, or payment records are copied from the old Firebase project. The new SQLite database persists across runs; there is no destructive reset button.

## Technical boundaries

This runs locally with a Node HTTP API, SQLite transactions, scrypt password hashes, HttpOnly sessions, and server-side authorization. Holds expire after 15 minutes; concurrent bookings of the last place cannot both succeed. Demo checkout records attempts and statuses but **does not collect money or reserve a live KDE tee time**. User cancellation defaults to a 24-hour cutoff that an admin can change per club. Paid demo cancellations are marked for manual review; there is no real refund integration. Uploaded images are local PNG/JPEG files limited to 2 MB. Email verification, password recovery, notifications, and a live payment gateway are not provided. Do not expose this local demo directly to the public internet without a production security/deployment pass.

## Admin on an existing account

After the golfer signs up, a machine owner can grant the admin role from the project terminal:

```powershell
npm run admin:grant -- person@example.com
```

Sign out and back in to refresh the role. This command changes only the separate GoGolf Next SQLite database and records the change in the audit log.
