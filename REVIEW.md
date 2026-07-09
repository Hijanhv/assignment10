# PR Review — "Bookmark lessons"

**Verdict up front: Request changes / block.** The feature works on the happy path with a small dataset, but it has two access-control bugs that let one user act on another user's data, and its "newest first" ordering is built on an unsortable timestamp. Those must be fixed before merge. Details below, ordered by severity.

---

## Blockers

### 1. POST trusts `userId` from the request body — broken access control (IDOR)
- **Where:** `src/routes/bookmarks.js`, `POST /` (lines 11–27)
- **What:** `userId` is read from `req.body`, not from the authenticated `req.user.id`. The route already has `requireAuth` and access to `req.user`, but ignores it when writing.
- **Why it matters:** Any authenticated user can create bookmarks *as another user* by sending a different `userId` in the body (e.g. `{ userId: "<someone-else>", lessonId }`). It also means the record's owner is attacker-controlled. This is a real authorization vulnerability, not a theoretical one — it ships the moment this merges.
- **Severity:** `blocker`
- **Suggested fix:** Drop `userId` from the request contract entirely and derive it from the token:
  ```js
  const { lessonId } = req.body;
  if (!lessonId) return res.status(400).json({ error: 'lessonId is required' });
  const bookmark = await Bookmark.create({ userId: req.user.id, lessonId });
  ```

### 2. DELETE is both insecure and effectively non-functional
- **Where:** `src/routes/bookmarks.js`, `DELETE /:lessonId` (line 38)
- **What:** It scopes the delete by `req.body.userId`. But the frontend (`resourceManager.remove` → `api.delete(url)`) sends **no body**, so `userId` is `undefined`. The query is therefore not scoped to the caller at all.
- **Why it matters:** With `userId` undefined, `deleteOne` either matches nothing (unbookmark silently does nothing server-side — the item comes back on refresh) or, depending on driver `undefined` handling, deletes whichever user's bookmark matches that `lessonId` — i.e. one user can delete another user's bookmark. Same IDOR class as #1, plus the feature doesn't actually work.
- **Severity:** `blocker`
- **Suggested fix:** Scope by the authenticated user and never trust the body:
  ```js
  await Bookmark.deleteOne({ userId: req.user.id, lessonId: req.params.lessonId });
  ```

---

## Has been fixed

### 3. `createdAt` is a locale-formatted string, which breaks "newest first"
- **Where:** `src/models/Bookmark.js` (lines 12–14, `type: String`) + `src/routes/bookmarks.js` line 26 (`new Date().toLocaleString()`)
- **What:** The timestamp is stored as human-readable text like `"7/9/2026, 10:39:00 PM"`, whose format depends on the server's locale and timezone. GET then sorts with `new Date(b.bookmarkedAt) - new Date(a.bookmarkedAt)`.
- **Why it matters:** `new Date("7/9/2026, 10:39:00 PM")` only parses on US-locale runtimes; on most non-US server locales it yields `Invalid Date` → `NaN`, and the sort silently returns items in arbitrary order. The core requirement ("newest first") is not reliably met, and you can't sort in the DB either since it's a string. It also can't survive a locale/timezone change on the host.
- **Severity:** has been fixed (arguably `blocker` — it defeats a stated requirement)
- **Suggested fix:** Store a real date and let Mongo sort it. In the model use `{ timestamps: true }` (or `createdAt: { type: Date, default: Date.now }`), drop `createdAt` from the `create()` call, and sort in the query: `Bookmark.find({ userId: req.user.id }).sort({ createdAt: -1 })`.

### 4. N+1 queries when building the bookmark list
- **Where:** `src/routes/bookmarks.js`, GET (lines 53–65)
- **What:** One `Lesson.findById` per bookmark, awaited in a loop.
- **Why it matters:** This is exactly the case the PR's "tested by hand with a small dataset" note hides. A user with 200 bookmarks triggers 201 sequential DB round-trips per list load — slow response, and it scales linearly with each user's bookmark count. It'll look fine in review and fall over in production.
- **Severity:** has been fixed
- **Suggested fix:** Batch it — `Lesson.find({ _id: { $in: lessonIds } })` and map, or make `lessonId` a real ref and use `.populate('lessonId', 'title category thumbnailUrl')`.

### 5. GET swallows errors and returns an empty list with a 200
- **Where:** `src/routes/bookmarks.js`, GET catch block (lines 71–73)
- **What:** On any error it returns `{ bookmarks: [] }` with status 200 and no logging.
- **Why it matters:** A DB outage or bug is indistinguishable from "you have no bookmarks." The user thinks their data vanished (and may re-bookmark), on-call gets no 5xx signal, and there's nothing in the logs to debug. Failures should be observable, not disguised as empty success.
- **Severity:** has been fixed
- **Suggested fix:** Log the error and return a 500: `catch (err) { logger.error(err); return res.status(500).json({ error: 'Failed to load bookmarks' }); }`. Handle the error state in the client (see #6).

### 6. Screen hangs on a spinner forever if the load fails
- **Where:** `app/screens/BookmarksScreen.jsx`, `useEffect` / `load()` (lines 19–26)
- **What:** No try/catch/finally. `setIsLoading(false)` only runs if `list()` resolves. `data.bookmarks` also assumes a shape.
- **Why it matters:** Any network hiccup (offline, timeout, 500) leaves the user staring at an infinite `ActivityIndicator` with no error and no retry — the most common real-world path once you leave the author's test device. An unhandled rejection is also thrown.
- **Severity:** has been fixed
- **Suggested fix:** Wrap in try/catch/finally, set an error state, and guard the shape:
  ```js
  try { const data = await bookmarksManager.list(); setBookmarks(data?.bookmarks ?? []); }
  catch (e) { setError(true); }
  finally { setIsLoading(false); }
  ```
  Render a retry state when `error` is set.

### 7. Optimistic unbookmark never rolls back on failure
- **Where:** `app/screens/BookmarksScreen.jsx`, `handleUnbookmark` (lines 28–32)
- **What:** The row is removed from state immediately, then `bookmarksManager.remove(lessonId)` is fired without `await` or `.catch`.
- **Why it matters:** If the server call fails (and per #2 it currently fails silently), the UI says "removed" but the bookmark is still there — it reappears on the next load, which reads as a flaky/buggy app and erodes trust. Optimistic UI needs a rollback path.
- **Severity:** has been fixed
- **Suggested fix:** `await` the remove and restore the item on error, and use a functional update to avoid stale state: `setBookmarks(prev => prev.filter(b => b.lessonId !== lessonId))`, then on catch re-add.

### 8. Duplicate-prevention has a race condition
- **Where:** `src/routes/bookmarks.js` (lines 18–21) + `src/models/Bookmark.js`
- **What:** `findOne` then `create` is a check-then-act with nothing enforcing uniqueness at the DB level.
- **Why it matters:** Two near-simultaneous requests (double-tap, retry) both pass the `findOne` and both insert → duplicate bookmarks, which then show up twice in the list. Hand-testing won't surface this.
- **Severity:** has been fixed
- **Suggested fix:** Add a unique compound index and let the DB enforce it: `bookmarkSchema.index({ userId: 1, lessonId: 1 }, { unique: true })`, then treat a duplicate-key error as the 409. This also lets you keep POST idempotent.

### 9. `resourceManager.js` is over-engineered for the need
- **Where:** `app/lib/resourceManager.js` (whole file)
- **What:** A factory-that-returns-a-factory, request/response interceptor pipelines, and a mutable `configure()` on a shared singleton — to expose `list` / `create` / `remove` for one resource. The justifying comment is "so future resources can reuse it," i.e. speculative.
- **Why it matters:** This is abstraction ahead of a second use case. It's more surface to read, test, and get wrong (e.g. `configure()` mutates shared `merged` state on the exported singleton — cross-contamination risk), for zero current benefit. When notes/downloads actually arrive, the right abstraction will be clearer than it is now. Reviews should push back on complexity that isn't paying rent yet.
- **Severity:** has been fixed (maintainability judgment call)
- **Suggested fix:** Replace with a small, direct module: three thin functions calling `api.get/post/delete('/api/bookmarks')`. Extract a generic helper later, when there's a real second consumer.

---

## Nits

- **Index as `keyExtractor`** — `BookmarksScreen.jsx` line 56 uses `String(index)`. Because rows are removed on unbookmark, index-based keys make React reconcile the wrong rows (stale images/state on recycled `FlatList` cells). Use `item.id` or `item.lessonId`. *(Borderline — has been fixed.)*
- **Dead loading toggle** — `handleOpenLesson` (lines 34–38) sets `isLoading` true then false synchronously; the "block double taps" comment is inaccurate (it blocks nothing and would flash a spinner if it did). Remove it.
- **Unused `user`** — `const { user } = useAuth()` (line 15) is never used. Drop it.
- **No thumbnail fallback** — `<Image source={{ uri: item.thumbnailUrl }} />` (line 62) renders blank if the URL is null/broken; add a placeholder.
- **Model typing** — `userId`/`lessonId` as `String` (should be `ObjectId` with `ref`) blocks `.populate()` and allows inconsistent types; pairs with fix #4.
- **No lesson-existence / ObjectId validation on POST** — you can bookmark a non-existent `lessonId`; it's silently dropped by GET's existence filter, so it just quietly does nothing.
- **No pagination on GET** — returns every bookmark; fine now, worth a `limit`/cursor before the list grows.

---

## Summary verdict

**Request changes — do not merge as-is.** The feature demos correctly, but the write paths trust a client-supplied `userId` instead of the JWT identity, which is a genuine authorization hole, and the DELETE path doesn't even function as written because the client sends no body. Separately, "newest first" rests on a locale-dependent timestamp string that won't reliably sort. These aren't polish items — they're correctness and security.

**Top 3 I'd insist on before merge:**
1. **Derive `userId` from `req.user.id` on both POST and DELETE (#1, #2).** Security and correctness; without it users can read/write across accounts and unbookmark is broken.
2. **Store `createdAt` as a real `Date` and sort in the DB (#3).** It's the difference between the stated requirement working and working only on a US-locale server by accident.
3. **Handle the failure paths — server errors (#5) and the client's load/unbookmark flows (#6, #7).** The current code is only correct on the happy path; the first network blip gives an infinite spinner or silent data drift.

Everything else (N+1, unique index, the over-built resource manager, nits) I'd want addressed but wouldn't block the merge on individually.
