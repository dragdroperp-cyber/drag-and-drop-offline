import React from 'react';

/**
 * PWA Update Notification Component
 * Shows a popup when a new service worker version is available
 */
const UpdateNotification = ({ onUpdate, onDismiss }) => {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm"
        onClick={onDismiss}
      >
        {/* Modal */}
        <div
          className="bg-white dark:bg-black rounded-2xl shadow-xl max-w-sm w-full mx-4 relative border border-gray-100 dark:border-white/10 animate-slideUp"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 text-xl font-bold leading-none transition-colors"
            aria-label="Close update notification"
          >
            ×
          </button>

          {/* Content */}
          <div className="p-8">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <span className="text-3xl">🚀</span>
              </div>
            </div>

            {/* Title */}
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-3">
              Update Available
            </h2>

            {/* Description */}
            <p className="text-gray-600 dark:text-slate-400 text-center mb-8 text-sm leading-relaxed">
              A new version of Grocery Studio is available with improved features and performance.
              Update now to stay ahead.
            </p>

            {/* Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={onUpdate}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/25 active:scale-95"
              >
                Update Now
              </button>
              <button
                onClick={onDismiss}
                className="w-full px-6 py-3 text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl font-semibold transition-all active:scale-95"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default UpdateNotification;
