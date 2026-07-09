# Take-Home: Code Review Exercise

**Time budget: 90 minutes max. Please do not spend more.**

## Context

You've just joined a small team building a mobile learning app (React Native / Expo frontend, Node + Express + MongoDB backend, JWT auth). A teammate has opened a pull request adding a **"Bookmark lessons"** feature:

- Users can bookmark/unbookmark lessons
- Users can view a list of their bookmarked lessons, newest first

The PR "works" — it was tested by hand on one device with a small dataset, and the author is asking for review before merge. Your job is to **review it the way you would review a real PR at work.**

## The files under review

```
src/routes/bookmarks.js      — new API routes
src/models/Bookmark.js       — new Mongoose model
app/lib/resourceManager.js   — new frontend helper
app/screens/BookmarksScreen.jsx — new screen
```

Assume the rest of the app (auth middleware, `Lesson` model, navigation, API client config) already exists and works. `requireAuth` verifies the JWT and sets `req.user = { id, email }`.

## What to submit

A single markdown file (`REVIEW.md`) containing your review comments, written as you would post them on GitHub. For each issue:

1. **Where** — file and line/function
2. **What** — what's wrong
3. **Why it matters** — the real-world consequence (what breaks, when, for whom)
4. **Severity** — `blocker` / `should-fix` / `nit`
5. **Suggested fix** — a sentence or short snippet is fine; you don't need to rewrite the PR

Then finish with a short **summary verdict** (3–6 sentences): would you approve, request changes, or block? What are the top 3 things you'd insist on before merge, and why those three?

## Rules

- **Use AI tools. We assume you will.** Claude, Copilot, Cursor, whatever's in your normal workflow — use it the way you'd use it on the job. There's no version of this exercise where withholding AI use helps you, so there's no reason to hide it either.
- What we're evaluating is **your judgment**, not your typing speed: which issues you surface, how you prioritize them, and how clearly you explain impact. A review that lists 40 undifferentiated nitpicks scores worse than one that nails the 5 things that actually matter.
