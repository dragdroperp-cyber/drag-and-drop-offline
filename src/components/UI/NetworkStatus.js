import React, { useState, useEffect } from 'react';
import { getConnectionQuality, addNetworkStatusListener, isSlowConnection } from '../../utils/networkRetry';
const NetworkStatus = () => {
  const [connectionQuality, setConnectionQuality] = useState(getConnectionQuality());
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => {
    const unsubscribe = addNetworkStatusListener(() => {
      setConnectionQuality(getConnectionQuality());
    });
    return unsubscribe;
  }, []);
  const isSlow = isSlowConnection();
  return (
    <div className="relative">
      <div
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
          connectionQuality.quality === 'excellent' ? 'bg-green-100 text-green-700 hover:bg-green-200' :
          connectionQuality.quality === 'good' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' :
          connectionQuality.quality === 'fair' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
          'bg-red-100 text-red-700 hover:bg-red-200'
        }`}
        onClick={() => setShowDetails(!showDetails)}
        title="Click to see connection details"
      >
        <span className="text-sm">{connectionQuality.icon}</span>
        <span className="hidden sm:inline capitalize">{connectionQuality.quality}</span>
      </div>
      {showDetails && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[103]"
            onClick={() => setShowDetails(false)}
          />
          {/* Details popover */}
          <div className="fixed top-8 right-0 z-[104] w-64 bg-white rounded-lg shadow-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Connection Status</h3>
              <button
                onClick={() => setShowDetails(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Quality:</span>
                <span className={`text-sm font-medium ${connectionQuality.color} capitalize`}>
                  {connectionQuality.icon} {connectionQuality.quality}
                </span>
              </div>
              {navigator.connection && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Type:</span>
                    <span className="text-sm font-medium text-gray-900">
                      {navigator.connection.effectiveType?.toUpperCase() || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Speed:</span>
                    <span className="text-sm font-medium text-gray-900">
                      {navigator.connection.downlink?.toFixed(1) || '?'} Mbps
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Latency:</span>
                    <span className="text-sm font-medium text-gray-900">
                      {navigator.connection.rtt || '?'}ms
                    </span>
                  </div>
                </>
              )}
              {isSlow && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <span className="text-yellow-600 mt-0.5">⚠️</span>
                    <div>
                      <p className="text-sm font-medium text-yellow-800">Slow Connection</p>
                      <p className="text-xs text-yellow-700 mt-1">
                        Some features may load slower. Data is cached locally for offline use.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  This app automatically adapts to your connection speed for the best experience.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
export default NetworkStatus;