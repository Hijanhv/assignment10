const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },
  },
  // Sortable Date createdAt (and updatedAt).
  { timestamps: true }
);

// One bookmark per (user, lesson); also blocks duplicate-insert races.
bookmarkSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

module.exports = mongoose.model('Bookmark', bookmarkSchema);
