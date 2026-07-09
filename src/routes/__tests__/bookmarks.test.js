/**
 * Route tests for the bookmarks API.
 *
 * Run: `npm install && npm test` from the repo root.
 *
 * The DB and the surrounding app are mocked, so these run with no Mongo/network:
 *  - `../../models/Bookmark` is replaced with jest mocks
 *  - `../../models/Lesson` and `../../middleware/auth` are virtual mocks
 *    (they live elsewhere in the real app; here we stub them)
 *  - `requireAuth` always authenticates as user `user-1`
 *
 * Coverage focuses on the behaviors that changed in review:
 *  auth scoping (owner from JWT, not the body), validation, duplicate handling,
 *  pagination, and error surfacing.
 */

const express = require('express');
const request = require('supertest');

const VALID_LESSON_ID = '507f1f77bcf86cd799439011';
const AUTH_USER_ID = 'user-1';

// --- Mocks (names must start with `mock` to satisfy jest.mock hoisting) ---
const mockBookmark = {
  create: jest.fn(),
  deleteOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};
const mockLesson = { findById: jest.fn() };

jest.mock('../../models/Bookmark', () => mockBookmark);
jest.mock('../../models/Lesson', () => mockLesson, { virtual: true });
jest.mock(
  '../../middleware/auth',
  () => ({
    requireAuth: (req, _res, next) => {
      req.user = { id: 'user-1', email: 'a@b.c' };
      next();
    },
  }),
  { virtual: true }
);

const bookmarksRouter = require('../bookmarks');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bookmarks', bookmarksRouter);
  return app;
}

// Builds a thenable Mongoose-style query whose chain methods return itself and
// which resolves to `value` when awaited.
function query(value) {
  const q = {
    sort: jest.fn(() => q),
    skip: jest.fn(() => q),
    limit: jest.fn(() => q),
    populate: jest.fn(() => q),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
}

let app;
beforeEach(() => {
  jest.clearAllMocks();
  app = buildApp();
});

describe('POST /api/bookmarks', () => {
  test('creates a bookmark owned by the JWT user, ignoring any body userId', async () => {
    mockLesson.findById.mockResolvedValue({ _id: VALID_LESSON_ID });
    mockBookmark.create.mockResolvedValue({ _id: 'bm1', userId: AUTH_USER_ID, lessonId: VALID_LESSON_ID });

    const res = await request(app)
      .post('/api/bookmarks')
      // attacker attempts to bookmark on behalf of someone else:
      .send({ lessonId: VALID_LESSON_ID, userId: 'someone-else' });

    expect(res.status).toBe(201);
    expect(mockBookmark.create).toHaveBeenCalledWith({
      userId: AUTH_USER_ID, // <- from the token, NOT the body
      lessonId: VALID_LESSON_ID,
    });
  });

  test('400 when lessonId is missing or malformed', async () => {
    const res = await request(app).post('/api/bookmarks').send({ lessonId: 'not-an-id' });
    expect(res.status).toBe(400);
    expect(mockBookmark.create).not.toHaveBeenCalled();
  });

  test('404 when the lesson does not exist', async () => {
    mockLesson.findById.mockResolvedValue(null);
    const res = await request(app).post('/api/bookmarks').send({ lessonId: VALID_LESSON_ID });
    expect(res.status).toBe(404);
    expect(mockBookmark.create).not.toHaveBeenCalled();
  });

  test('409 when the unique index rejects a duplicate', async () => {
    mockLesson.findById.mockResolvedValue({ _id: VALID_LESSON_ID });
    mockBookmark.create.mockRejectedValue({ code: 11000 });
    const res = await request(app).post('/api/bookmarks').send({ lessonId: VALID_LESSON_ID });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/bookmarks/:lessonId', () => {
  test('scopes the delete to the authenticated user and returns 204', async () => {
    mockBookmark.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const res = await request(app).delete(`/api/bookmarks/${VALID_LESSON_ID}`);

    expect(res.status).toBe(204);
    expect(mockBookmark.deleteOne).toHaveBeenCalledWith({
      userId: AUTH_USER_ID, // <- caller can only delete their own bookmark
      lessonId: VALID_LESSON_ID,
    });
  });

  test('400 on a malformed lessonId', async () => {
    const res = await request(app).delete('/api/bookmarks/not-an-id');
    expect(res.status).toBe(400);
    expect(mockBookmark.deleteOne).not.toHaveBeenCalled();
  });
});

describe('GET /api/bookmarks', () => {
  test('returns a page of bookmarks with metadata and drops dangling lessons', async () => {
    mockBookmark.countDocuments.mockResolvedValue(5);
    mockBookmark.find.mockReturnValue(
      query([
        {
          _id: 'bm1',
          createdAt: new Date('2026-01-02'),
          lessonId: { _id: VALID_LESSON_ID, title: 'T1', category: 'C', thumbnailUrl: 'u' },
        },
        // lesson was deleted since bookmarking -> populate() yields null -> filtered out
        { _id: 'bm2', createdAt: new Date('2026-01-01'), lessonId: null },
      ])
    );

    const res = await request(app).get('/api/bookmarks?page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.bookmarks).toHaveLength(1);
    expect(res.body.bookmarks[0]).toMatchObject({ id: 'bm1', lessonId: VALID_LESSON_ID, title: 'T1' });
    expect(res.body).toMatchObject({ page: 1, limit: 2, total: 5, hasMore: true });
  });

  test('clamps limit to a max of 100 and scopes the query to the user', async () => {
    mockBookmark.countDocuments.mockResolvedValue(0);
    const q = query([]);
    mockBookmark.find.mockReturnValue(q);

    await request(app).get('/api/bookmarks?limit=9999');

    expect(mockBookmark.find).toHaveBeenCalledWith({ userId: AUTH_USER_ID });
    expect(q.limit).toHaveBeenCalledWith(100);
  });

  test('500 (not an empty list) when the query fails', async () => {
    mockBookmark.countDocuments.mockRejectedValue(new Error('db down'));
    mockBookmark.find.mockReturnValue(query([]));

    const res = await request(app).get('/api/bookmarks');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
