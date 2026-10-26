# GoGolf feature audit (26 October 2026)

Target: `GoGolf-Next`. The historical `Gogolf-revival` Ionic repository was read as a reference and has not been edited.

| Area | Historical KDE FYP | GoGolf Next before this work | Decision |
| --- | --- | --- | --- |
| Identity | KDE logo, course photo, and `courses.png` 18-hole layout | Generic SVG fairway and “GoGolf Course” | Copy the historical KDE assets into this new project, label their source, and make KDE the first club. |
| Discovery | One KDE context, course layout on its own page | No club or course records | Add club/course records and location/name search. |
| Authentication | Firebase Auth and Firestore `users`; admin route guard | None | Add separate local accounts and server-side role checks. Do not reuse the old Firebase project or customer records. |
| Booking | Firestore `events` and `hours`; client filters slots by day number and deducts wallet balance | Browser-only six hardcoded slots, no accounts | Store schedule, capacity, holds, reservations, and price on the server. Recheck capacity inside a SQLite write transaction. |
| Payment | Balance field updated by the client; no distinct payment attempts or verified status | None | Add isolated demo checkout with persisted success/failure/cancelled attempts. No card data or live gateway. |
| Profile | Name editing and score history | Browser-only scorecards, no profile | Server-backed profile, bookings, reviews, and scores. |
| Reviews | Firebase collection with rating/text; historical demo reviews are synthetic | No reviews or comments | Add new, attributable reviews and comments. Do not import synthetic historical reviews as genuine. |
| Admin | Price edit, event list, news edit, add-cash screen | Browser-only slot blocking, prices, notes | Server-protected club/course/schedule/booking/user/payment/moderation views. |

Historical asset evidence: `src/assets/imgs/courses.png` is the actual KDE course/slope rating layout; `kde.jpg` is a course photograph and `kde logo.png` is the club mark. The image labels KDE Recreation Bhd and Petaling Jaya, Selangor. Its printed contact details are not imported into live contact fields.

The former `GoGolf-Next` browser-storage key, `gogolf-next-demo-v1`, is left intact. It contains prototype demo data, not real KDE inventory or payments.
