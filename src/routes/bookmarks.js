const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Bookmark = require('../models/Bookmark');
const Lesson = require('../models/Lesson');
const { requireAuth } = require('../middleware/auth');

// POST /api/bookmarks   Body: { lessonId }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { lessonId } = req.body;

    if (!lessonId || !mongoose.Types.ObjectId.isValid(lessonId)) {
      return res.status(400).json({ error: 'A valid lessonId is required' });
    }

    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Owner is the authenticated user, never a client-supplied id.
    const bookmark = await Bookmark.create({
      userId: req.user.id,
      lessonId,
    });

    return res.status(201).json({ bookmark });
  } catch (err) {
    if (err && err.code === 11000) {
      // Duplicate key from the unique (userId, lessonId) index.
      return res.status(409).json({ error: 'Already bookmarked' });
    }
    console.error('POST /api/bookmarks failed', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
});

// DELETE /api/bookmarks/:lessonId
router.delete('/:lessonId', requireAuth, async (req, res) => {
  try {
    const { lessonId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(lessonId)) {
      return res.status(400).json({ error: 'A valid lessonId is required' });
    }

    // Scoped to the caller's own bookmark. Idempotent: a no-op still 204s.
    await Bookmark.deleteOne({ userId: req.user.id, lessonId });

    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/bookmarks failed', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
});

// GET /api/bookmarks?page=1&limit=20   Bookmarked lessons, newest first.
router.get('/', requireAuth, async (req, res) => {
  try {
    // Clamp so a client can't request an unbounded page.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { userId: req.user.id };

    // One populate() for the lessons instead of a findById per bookmark.
    const [total, bookmarks] = await Promise.all([
      Bookmark.countDocuments(filter),
      Bookmark.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('lessonId', 'title category thumbnailUrl'),
    ]);

    const results = bookmarks
      .filter((bm) => bm.lessonId) // lesson may have been deleted
      .map((bm) => ({
        id: bm._id,
        lessonId: bm.lessonId._id,
        title: bm.lessonId.title,
        category: bm.lessonId.category,
        thumbnailUrl: bm.lessonId.thumbnailUrl,
        bookmarkedAt: bm.createdAt,
      }));

    return res.json({
      bookmarks: results,
      page,
      limit,
      total,
      // Uses rows fetched, so filtering deleted lessons doesn't skew it.
      hasMore: skip + bookmarks.length < total,
    });
  } catch (err) {
    console.error('GET /api/bookmarks failed', err);
    return res.status(500).json({ error: 'Failed to load bookmarks' });
  }
});

module.exports = router;
