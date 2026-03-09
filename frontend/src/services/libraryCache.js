// Simple in-memory cache shared across all pages
// Data survives page navigation but clears on full browser refresh

const cache = {
  libraries: null,
  fetchedAt: null,
  ttlMs: 5 * 60 * 1000, // 5 minutes — must match backend TTL
};

export const libraryCache = {
  get() {
    if (!cache.libraries || !cache.fetchedAt) return null;
    const ageMs = Date.now() - cache.fetchedAt;
    if (ageMs > cache.ttlMs) return null; // expired
    return cache.libraries;
  },

  set(data) {
    cache.libraries = data;
    cache.fetchedAt = Date.now();
  },

  clear() {
    cache.libraries = null;
    cache.fetchedAt = null;
  },

  ageSeconds() {
    if (!cache.fetchedAt) return null;
    return Math.floor((Date.now() - cache.fetchedAt) / 1000);
  }
};
