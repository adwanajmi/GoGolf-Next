# GoGolf Next

A new, separate local version of GoGolf. The original `Gogolf-revival` project and its Firebase data are untouched.

## Run locally

Requires a current Node.js version compatible with Vite 8.

```powershell
cd C:\Users\man010\Downloads\GoGolf-Next
npm install
npm run dev -- --host 127.0.0.1 --port 8200
```

Open [http://127.0.0.1:8200/](http://127.0.0.1:8200/). To check the production build, run `npm run build`.

## Explore the demo

- **Overview:** next round, open tee times, scores, and a club note.
- **Book a round:** choose one of the next 14 days, 9 or 18 holes, 1–4 players, and an available tee time. The price is calculated before confirmation.
- **My bookings:** see upcoming and earlier rounds; cancel an upcoming demo booking to reopen its slot.
- **Scorecards:** record hole by hole strokes for a 9 or 18 hole round.
- **Club journal:** read course notes.
- **Club admin:** block or reopen slots, edit base prices, publish notes, and reset the sample data.

The app starts with sample bookings, scorecards, notes, and a blocked tee time. Changes persist in this browser's local storage for `127.0.0.1:8200`. Use **Club admin → Reset demo data** to restore the samples. A different browser or port has separate data.

## Scope

This is a working local prototype. It has no account sign in, Firebase connection, shared database, payment processing, or real course reservation. The club admin screen is open to anyone with access to this local app; it must have authentication before any public deployment. Prices and course details are sample content. `DESIGN.md` records the visual direction.
