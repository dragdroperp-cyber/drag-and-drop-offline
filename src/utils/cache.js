import { openDB } from 'idb';
// Cache configuration
const CACHE_CONFIG = {
  name: 'api-cache',
  version: 1,
  stores: {
    responses: 'responses', // Cache API responses
    metadata: 'metadata'    // Cache metadata and timestamps
  }
};
// Cache TTL in milliseconds
const CACHE_TTL = {
  // Short-lived caches for frequently changing data
  products: 5 * 60 * 1000,      // 5 minutes
  customers: 10 * 60 * 1000,    // 10 minutes
  orders: 2 * 60 * 1000,        // 2 minutes
  transactions: 1 * 60 * 1000,  // 1 minute
  // Longer-lived caches for static data
  categories: 60 * 60 * 1000,   // 1 hour
  reports: 30 * 60 * 1000,      // 30 minutes
  dashboard: 15 * 60 * 1000,    // 15 minutes
};
// Initialize IndexedDB cache
let cacheDB = null;
const initCacheDB = async () => {
  if (cacheDB) return cacheDB;
  cacheDB = await openDB(CACHE_CONFIG.name, CACHE_CONFIG.version, {
    upgrade(db) {
      // Create stores if they don't exist
      if (!db.objectStoreNames.contains(CACHE_CONFIG.stores.responses)) {
        const responseStore = db.createObjectStore(CACHE_CONFIG.stores.responses, {
          keyPath: 'key'
        });
        responseStore.createIndex('timestamp', 'timestamp');
        responseStore.createIndex('endpoint', 'endpoint');
      }
      if (!db.objectStoreNames.contains(CACHE_CONFIG.stores.metadata)) {
        db.createObjectStore(CACHE_CONFIG.stores.metadata, {
          keyPath: 'key'
        });
      }
    }
  });
  return cacheDB;
};
// Generate cache key from request details
const generateCacheKey = (method, url, body = null, sellerId = null) => {
  const keyData = {
    method: method.toUpperCase(),
    url,
    body: body ? JSON.stringify(body) : null,
    sellerId
  };
  return btoa(JSON.stringify(keyData));
};
// Check if cache entry is still valid
const isCacheValid = (timestamp, cacheType = 'default') => {
  const ttl = CACHE_TTL[cacheType] || CACHE_TTL.default || 5 * 60 * 1000; // 5 minutes default
  return Date.now() - timestamp < ttl;
};
// Cache API response
export const cacheResponse = async (method, url, body, response, sellerId = null, cacheType = 'default') => {
  try {
    const db = await initCacheDB();
    const key = generateCacheKey(method, url, body, sellerId);
    const cacheEntry = {
      key,
      method: method.toUpperCase(),
      url,
      body: body ? JSON.stringify(body) : null,
      sellerId,
      response: JSON.stringify(response),
      timestamp: Date.now(),
      cacheType
    };
    await db.put(CACHE_CONFIG.stores.responses, cacheEntry);
  } catch (error) {
  }
};
// Get cached response
export const getCachedResponse = async (method, url, body, sellerId = null, cacheType = 'default') => {
  try {
    const db = await initCacheDB();
    const key = generateCacheKey(method, url, body, sellerId);
    const cached = await db.get(CACHE_CONFIG.stores.responses, key);
    if (cached && isCacheValid(cached.timestamp, cacheType)) {
      return JSON.parse(cached.response);
    }
    if (cached && !isCacheValid(cached.timestamp, cacheType)) {
      // Clean up expired entry
      await db.delete(CACHE_CONFIG.stores.responses, key);
    }
    return null;
  } catch (error) {
    return null;
  }
};
// Clear specific cache entries
export const clearCache = async (pattern = null) => {
  try {
    const db = await initCacheDB();
    if (pattern) {
      // Clear entries matching pattern
      const keys = await db.getAllKeys(CACHE_CONFIG.stores.responses);
      const matchingKeys = keys.filter(key => {
        try {
          const decoded = JSON.parse(atob(key));
          return decoded.url.includes(pattern);
        } catch {
          return false;
        }
      });
      await Promise.all(matchingKeys.map(key => db.delete(CACHE_CONFIG.stores.responses, key)));
    } else {
      // Clear all cache
      await db.clear(CACHE_CONFIG.stores.responses);
    }
  } catch (error) {
  }
};
// Cache statistics
export const getCacheStats = async () => {
  try {
    const db = await initCacheDB();
    const allEntries = await db.getAll(CACHE_CONFIG.stores.responses);
    const stats = {
      totalEntries: allEntries.length,
      totalSize: allEntries.reduce((size, entry) => size + JSON.stringify(entry).length, 0),
      byType: {},
      expired: 0
    };
    allEntries.forEach(entry => {
      const type = entry.cacheType || 'default';
      if (!stats.byType[type]) {
        stats.byType[type] = 0;
      }
      stats.byType[type]++;
      if (!isCacheValid(entry.timestamp, type)) {
        stats.expired++;
      }
    });
    return stats;
  } catch (error) {
    return null;
  }
};
// Clean expired cache entries
export const cleanExpiredCache = async () => {
  try {
    const db = await initCacheDB();
    const allEntries = await db.getAll(CACHE_CONFIG.stores.responses);
    const expiredKeys = allEntries
      .filter(entry => !isCacheValid(entry.timestamp, entry.cacheType))
      .map(entry => entry.key);
    if (expiredKeys.length > 0) {
      await Promise.all(expiredKeys.map(key => db.delete(CACHE_CONFIG.stores.responses, key)));
    }
    return expiredKeys.length;
  } catch (error) {
    return 0;
  }
};