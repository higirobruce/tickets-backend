# Event owner onboarding — design

Date: 2026-10-13. Status: built in the same session, uncommitted, awaiting review.

## Intent (what was asked)
"A feature to onboard event owners that should be able to create multiple events and be able to see their event's dashboards."

## Assumptions (not stated by the user; change on request)
1. Onboarding is self-service: an organiser signs up on the web and is active immediately, no admin approval step.
2. Events created by organisers are listed publicly on the home page right away, like events created today.
3. Three roles: `admin` (platform operator, sees everything, creates staff), `organiser` (event owner), `staff` (gate). Accounts that predate roles are treated as `admin` so the operator is never locked out.
4. A dashboard is per event: tickets sold, revenue, consumed vs pending, by package, recent sales. It uses the data already stored on tickets (MoMo payload amounts), no new tracking.
5. Organisers may also consume tickets for their own events (they will often run the gate themselves); they may not touch other organisers' events or tickets.

## Backend
- `users.role` (admin | organiser | staff), `users.organisation`. Token carries the role.
- `events.owner` → user. Legacy events have no owner; only admins see them in "my events".
- New routes
  - `POST /users/register` (public): organiser self-signup → 201 `{ token, user }`. 409 on a used email.
  - `GET /users/me` (auth).
  - `GET /events/mine` (auth): own events; admin gets all.
  - `PUT /events/:id` (owner or admin): title, artist, date, location, imageUrl, packages, status.
  - `GET /events/:id/dashboard` (owner or admin): `{ event, totals, byPackage, recent }`.
- Changed rules
  - `POST /events`: organiser or admin; owner is the caller (admin may pass `owner`).
  - `POST /users`: first account ever becomes admin; afterwards admin only; `role` defaults to staff.
  - `GET /tickets`, `GET /tickets/summary`, consume: organisers are limited to their own events (403 otherwise).

## Web
- `/signup`: organiser registration, lands on `/organiser`.
- `/organiser`: my events with "New event"; cards link to the dashboard and edit page.
- `/organiser/events/new`, `/organiser/events/[id]/edit`: one shared event form with a package editor.
- `/organiser/events/[id]`: dashboard (tiles, by-package charts, recent sales).
- Nav shows Sign up / Login, or My events / Log out, depending on the session.
- Login on `/admin` sends organisers to `/organiser`.
- `next/image` accepts any https host so organiser-supplied image URLs render.

## Testing
Backend: vitest + supertest (`tests/organisers.test.ts`). Web: `next build` and a browser-less smoke run against the API.
