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
        className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4"
        onClick={onDismiss}
      >
        {/* Modal */}
        <div
          className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onDismiss}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl font-bold leading-none"
            aria-label="Close update notification"
          >
            ×
          </button>

          {/* Content */}
          <div className="p-6">
            {/* Icon */}
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-2xl">⬆️</span>
              </div>
            </div>

            {/* Title */}
            <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
              Update Available
            </h2>

            {/* Description */}
            <p className="text-gray-600 text-center mb-6 text-sm leading-relaxed">
              A new version of the app is available with improved features and bug fixes.
              Update now to get the latest version.
            </p>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={onDismiss}
                className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Later
              </button>
              <button
                onClick={onUpdate}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Update Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default UpdateNotification;
