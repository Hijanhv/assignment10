import { api } from './apiClient';

// Bookmarks API client. The server derives the owner from the JWT, so no userId here.
export const bookmarksManager = {
  async list(params = {}) {
    // params: { page, limit }
    const res = await api.get('/api/bookmarks', { params });
    return res.data;
  },
  async create(lessonId) {
    const res = await api.post('/api/bookmarks', { lessonId });
    return res.data;
  },
  async remove(lessonId) {
    const res = await api.delete(`/api/bookmarks/${lessonId}`);
    return res.data;
  },
};
