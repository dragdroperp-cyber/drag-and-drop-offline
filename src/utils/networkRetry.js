// Network retry and fallback utilities for slow 3G connections
// Network status detection
export const getNetworkStatus = () => {
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
      return {
        effectiveType: connection.effectiveType, // 'slow-2g', '2g', '3g', '4g'
        downlink: connection.downlink, // Mbps
        rtt: connection.rtt, // ms
        saveData: connection.saveData // boolean
      };
    }
  }
  // Fallback detection based on timing
  return {
    effectiveType: 'unknown',
    downlink: 0,
    rtt: 0,
    saveData: false
  };
};
// Check if connection is slow
export const isSlowConnection = () => {
  const status = getNetworkStatus();
  return status.effectiveType === 'slow-2g' ||
         status.effectiveType === '2g' ||
         status.downlink < 1 ||
         status.rtt > 1000;
};
// Retry configuration based on connection speed
export const getRetryConfig = () => {
  const isSlow = isSlowConnection();
  return {
    maxRetries: isSlow ? 5 : 3,
    baseDelay: isSlow ? 3000 : 1000, // 3s for slow, 1s for fast
    maxDelay: isSlow ? 15000 : 5000, // 15s for slow, 5s for fast
    backoffMultiplier: 1.5
  };
};
// Retry wrapper for API calls
export const withRetry = async (apiCall, options = {}) => {
  const config = getRetryConfig();
  const { maxRetries = config.maxRetries, onRetry } = options;
  let lastError;
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const result = await apiCall();
      return result;
    } catch (error) {
      lastError = error;
      attempt++;
      if (attempt > maxRetries) {
        break;
      }
      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelay
      );
      if (onRetry) {
        onRetry({ attempt, maxRetries, delay, error });
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};
// Network-aware API request wrapper
export const networkAwareApiRequest = async (endpoint, options = {}) => {
  const { apiRequest } = await import('./api');
  return withRetry(
    () => apiRequest(endpoint, options),
    {
      onRetry: ({ attempt, maxRetries, delay, error }) => {
        // Show toast notification for retries on slow connections
        if (isSlowConnection() && window.showToast) {
          window.showToast(
            `Slow connection detected. Retrying request (${attempt}/${maxRetries})...`,
            'info',
            2000
          );
        }
      }
    }
  );
};
// Connection quality indicator
export const getConnectionQuality = () => {
  const status = getNetworkStatus();
  if (status.effectiveType === '4g' && status.downlink >= 5) {
    return { quality: 'excellent', color: 'text-green-500', icon: '🚀' };
  } else if (status.effectiveType === '4g' || status.downlink >= 2) {
    return { quality: 'good', color: 'text-blue-500', icon: '📶' };
  } else if (status.effectiveType === '3g' || status.downlink >= 0.5) {
    return { quality: 'fair', color: 'text-yellow-500', icon: '📊' };
  } else {
    return { quality: 'poor', color: 'text-red-500', icon: '🐌' };
  }
};
// Preload critical resources based on connection
export const preloadCriticalResources = () => {
  const isSlow = isSlowConnection();
  if (!isSlow) {
    // Preload critical components on fast connections
    import('../components/Dashboard/Dashboard');
    import('../components/Products/Products');
  }
  // Always preload essential utilities
  import('./cache');
  import('./indexedDB');
};
// Network status monitoring
let networkStatusCallbacks = new Set();
export const addNetworkStatusListener = (callback) => {
  networkStatusCallbacks.add(callback);
  return () => networkStatusCallbacks.delete(callback);
};
export const removeNetworkStatusListener = (callback) => {
  networkStatusCallbacks.delete(callback);
};
// Monitor network changes
if (typeof window !== 'undefined') {
  let lastConnectionType = '';
  const checkNetworkChange = () => {
    const status = getNetworkStatus();
    const currentType = `${status.effectiveType}-${status.downlink}`;
    if (currentType !== lastConnectionType) {
      lastConnectionType = currentType;
      // Notify all listeners
      networkStatusCallbacks.forEach(callback => {
        try {
          callback(status);
        } catch (error) {
        }
      });
      // Show toast for significant changes
      if (isSlowConnection() && window.showToast) {
        window.showToast(
          'Slow connection detected. Some features may load slower.',
          'warning',
          3000
        );
      }
    }
  };
  // Check immediately
  checkNetworkChange();
  // Monitor connection changes
  if ('connection' in navigator) {
    navigator.connection.addEventListener('change', checkNetworkChange);
  }
  // Fallback polling for browsers without connection API
  setInterval(checkNetworkChange, 30000); // Check every 30 seconds
}