# Fixes Applied — "Bookmark lessons" PR

This document lists every issue found in review and exactly what was changed to
address it. Issues are grouped by severity. Each entry has: **Issue → Fix →
Files touched.**

Files changed:
- `src/models/Bookmark.js`
- `src/routes/bookmarks.js`
- `app/lib/resourceManager.js`
- `app/screens/BookmarksScreen.jsx`

---

## Blockers (security / correctness)

### B1 — POST trusted `userId` from the request body (IDOR)
- **Issue:** `POST /api/bookmarks` read the owner from `req.body.userId`, so any
  authenticated user could create bookmarks *as another user*.
- **Fix:** The owner is now always `req.user.id` (from the verified JWT).
  `userId` was removed from the request contract; only `lessonId` is accepted.
- **Files:** `src/routes/bookmarks.js` (POST handler), `app/lib/resourceManager.js`
  (`create` now sends only `{ lessonId }`).

### B2 — DELETE was insecure *and* non-functional
- **Issue:** `DELETE /:lessonId` scoped the delete by `req.body.userId`, but the
  client sends no body, so `userId` was `undefined`. The delete was not scoped
  to the caller — it either did nothing or could remove another user's bookmark.
- **Fix:** The query is now `{ userId: req.user.id, lessonId: req.params.lessonId }`.
  It is scoped to the authenticated user and works with no request body. Kept
  idempotent (a no-op delete still returns `204`) so it pairs cleanly with the
  optimistic UI.
- **Files:** `src/routes/bookmarks.js` (DELETE handler).

---

## Should-fix

### S1 — `createdAt` stored as a locale-formatted string broke "newest first"
- **Issue:** `createdAt: new Date().toLocaleString()` was written into a `String`
  field. It's locale/timezone-dependent text (e.g. `"7/9/2026, 10:39:00 PM"`)
  that yields `Invalid Date` on non-US runtimes, so the required newest-first
  sort was unreliable and un-sortable in the DB.
- **Fix:** Model now uses `{ timestamps: true }`, giving a real `Date`
  `createdAt`. The route no longer sets `createdAt` manually and sorts in the DB
  with `.sort({ createdAt: -1 })`.
- **Files:** `src/models/Bookmark.js`, `src/routes/bookmarks.js` (POST + GET).

### S2 — N+1 queries when building the list
- **Issue:** GET ran one `Lesson.findById` per bookmark inside a loop — fine on a
  tiny test set, linear DB round-trips in production.
- **Fix:** Replaced the loop with a single `.populate('lessonId', 'title
  category thumbnailUrl')`. Lessons deleted since bookmarking are filtered out
  (populate yields `null`), preserving the old behavior.
- **Files:** `src/routes/bookmarks.js` (GET handler), `src/models/Bookmark.js`
  (`lessonId` is now an `ObjectId` ref, which makes populate possible).

### S3 — GET swallowed errors and returned `{ bookmarks: [] }` with 200
- **Issue:** The catch block hid real failures (DB down, bugs) as "no bookmarks,"
  with no logging — undebuggable and misleading to users.
- **Fix:** The catch now logs the error and returns `500` with an error body. The
  client distinguishes this from an empty list (see S4).
- **Files:** `src/routes/bookmarks.js` (GET handler).

### S4 — Screen hung on the spinner forever if the load failed
- **Issue:** `load()` had no try/catch/finally, so a failed request never cleared
  `isLoading` → infinite spinner, plus an unhandled promise rejection.
- **Fix:** `load()` now uses try/catch/finally, sets an `error` state on failure,
  guards the response shape (`data?.bookmarks ?? []`), and always clears loading.
  Added an error view with a "Tap to retry" that re-runs `load()`.
- **Files:** `app/screens/BookmarksScreen.jsx`.

### S5 — Optimistic unbookmark never rolled back on failure
- **Issue:** The row was removed from state, then `remove()` was fired without
  `await`/`catch`. A failed server call left the UI out of sync (item reappears
  on next load).
- **Fix:** `handleUnbookmark` snapshots the list, removes optimistically via a
  functional update, `await`s the delete, and restores the snapshot on error.
- **Files:** `app/screens/BookmarksScreen.jsx`, `app/lib/resourceManager.js`.

### S6 — Race condition allowed duplicate bookmarks
- **Issue:** Duplicate prevention was a check-then-create (`findOne` then
  `create`) with nothing enforcing uniqueness — concurrent requests could both
  insert.
- **Fix:** Added a unique compound index `{ userId: 1, lessonId: 1 }`. POST no
  longer pre-checks; it catches the duplicate-key error (`code === 11000`) and
  returns `409`. The DB now guarantees uniqueness.
- **Files:** `src/models/Bookmark.js`, `src/routes/bookmarks.js` (POST handler).

### S7 — `resourceManager.js` was over-engineered
- **Issue:** A factory-returning-a-factory with interceptor pipelines and a
  mutable `configure()` on a shared singleton — significant surface for a
  three-method CRUD, justified only by speculative future reuse.
- **Fix:** Replaced with a small, direct `bookmarksManager` exposing `list`,
  `create(lessonId)`, and `remove(lessonId)`. A shared abstraction can be
  extracted later, against a real second use case.
- **Files:** `app/lib/resourceManager.js`.

---

## Nits

### N1 — Index used as `FlatList` key
- **Issue:** `keyExtractor={(item, index) => String(index)}`; because rows are
  removed on unbookmark, index keys make React reconcile the wrong rows.
- **Fix:** Now keys on stable identity: `String(item.id ?? item.lessonId)`.
- **Files:** `app/screens/BookmarksScreen.jsx`.

### N2 — Dead loading toggle in `handleOpenLesson`
- **Issue:** `setIsLoading(true)` immediately followed by `setIsLoading(false)`
  around a synchronous `navigate` — blocked nothing; the "block double taps"
  comment was inaccurate.
- **Fix:** Removed; `handleOpenLesson` just navigates.
- **Files:** `app/screens/BookmarksScreen.jsx`.

### N3 — Unused `user` from `useAuth()`
- **Issue:** `const { user } = useAuth()` was never used (identity comes from the
  JWT server-side).
- **Fix:** Removed the unused destructure and the `useAuth` import.
- **Files:** `app/screens/BookmarksScreen.jsx`.

### N4 — No thumbnail fallback
- **Issue:** `<Image source={{ uri: item.thumbnailUrl }} />` rendered blank/broken
  when the URL was missing.
- **Fix:** Guarded the `source` (undefined when no URL) and added a neutral
  background color so an empty thumbnail looks intentional.
- **Files:** `app/screens/BookmarksScreen.jsx`.

### N5 — Weak model typing
- **Issue:** `userId`/`lessonId` were `String`, blocking `.populate()` and
  allowing inconsistent types.
- **Fix:** Both are now `ObjectId` refs (`User` / `Lesson`), enabling populate
  and referential consistency.
- **Files:** `src/models/Bookmark.js`.

### N6 — No lesson-existence / ObjectId validation on POST
- **Issue:** You could bookmark a non-existent or malformed `lessonId`; GET
  silently dropped it.
- **Fix:** POST validates the `ObjectId` and 404s if the lesson doesn't exist.
- **Files:** `src/routes/bookmarks.js` (POST handler).

---

## Follow-ups completed

### F1 — Pagination on GET
- **Added:** `GET /api/bookmarks?page=&limit=` with `limit` clamped to `[1, 100]`
  (default 20), `skip/limit` in the DB, and a response envelope of
  `{ bookmarks, page, limit, total, hasMore }`. `hasMore` is computed from the
  raw page size so deleted-lesson filtering doesn't skew it.
- **Frontend:** `resourceManager.list({ page, limit })` forwards query params;
  `BookmarksScreen` consumes it with infinite scroll (`onEndReached` → next
  page, footer spinner) so the list isn't silently truncated to 20.
- **Files:** `src/routes/bookmarks.js`, `app/lib/resourceManager.js`,
  `app/screens/BookmarksScreen.jsx`.

### F2 — Route tests
- **Added:** `src/routes/__tests__/bookmarks.test.js` (Jest + supertest, DB and
  surrounding app mocked). 9 tests, all passing, covering: owner-from-JWT on POST
  (B1), delete scoping (B2), validation, 404, 409 duplicate (S6), pagination +
  dangling-lesson filtering (F1/S2), limit clamping, and the 500-not-empty-list
  path (S3). A minimal root `package.json` makes them runnable via
  `npm install && npm test`.
- **Files:** `src/routes/__tests__/bookmarks.test.js`, `package.json`.

## Notes

- **DELETE status semantics** — kept idempotent (`204` even when nothing matched)
  to play nicely with the optimistic UI rather than returning `404`.
- **Offset pagination caveat** — removing an item shifts offsets, so a rapid
  unbookmark during scroll could in theory skip/duplicate one row across a page
  boundary. Acceptable for now; cursor pagination on `createdAt` would remove it.
