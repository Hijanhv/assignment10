import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { bookmarksManager } from '../lib/resourceManager';

const PAGE_SIZE = 20;

export default function BookmarksScreen({ navigation }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(false);
    try {
      const data = await bookmarksManager.list({ page: 1, limit: PAGE_SIZE });
      setBookmarks(data?.bookmarks ?? []);
      setPage(1);
      setHasMore(Boolean(data?.hasMore));
    } catch (err) {
      // Show a retry state instead of hanging on the spinner.
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMore() {
    if (isLoadingMore || !hasMore) return;
    const next = page + 1;
    setIsLoadingMore(true);
    try {
      const data = await bookmarksManager.list({ page: next, limit: PAGE_SIZE });
      setBookmarks((prev) => [...prev, ...(data?.bookmarks ?? [])]);
      setPage(next);
      setHasMore(Boolean(data?.hasMore));
    } catch (err) {
      // Keep what we have; scrolling again retries.
    } finally {
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const handleUnbookmark = async (lessonId) => {
    // Optimistic remove; roll back if the server rejects.
    const previous = bookmarks;
    setBookmarks((prev) => prev.filter((b) => b.lessonId !== lessonId));
    try {
      await bookmarksManager.remove(lessonId);
    } catch (err) {
      setBookmarks(previous);
    }
  };

  const handleOpenLesson = (lessonId) => {
    navigation.navigate('LessonDetail', { lessonId });
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Couldn't load your bookmarks.</Text>
        <TouchableOpacity onPress={load}>
          <Text style={styles.retry}>Tap to retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Your Bookmarks</Text>
      {bookmarks.length === 0 ? (
        <Text style={styles.empty}>No bookmarks yet.</Text>
      ) : (
        <FlatList
          data={bookmarks}
          keyExtractor={(item) => String(item.id ?? item.lessonId)}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? <ActivityIndicator style={styles.footer} /> : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => handleOpenLesson(item.lessonId)}
            >
              <Image
                source={item.thumbnailUrl ? { uri: item.thumbnailUrl } : undefined}
                style={styles.thumb}
              />
              <View style={styles.rowText}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.category}>{item.category}</Text>
              </View>
              <TouchableOpacity onPress={() => handleUnbookmark(item.lessonId)}>
                <Text style={styles.remove}>Remove</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  empty: { color: '#666', marginTop: 24, textAlign: 'center' },
  footer: { marginVertical: 16 },
  retry: { color: '#06c', fontWeight: '600', marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  thumb: { width: 56, height: 56, borderRadius: 8, marginRight: 12, backgroundColor: '#eee' },
  rowText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  category: { color: '#888', marginTop: 2 },
  remove: { color: '#d33', fontWeight: '600' },
});
