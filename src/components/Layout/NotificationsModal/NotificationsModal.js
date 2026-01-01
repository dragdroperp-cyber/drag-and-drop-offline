import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../../context/AppContext';
import { X, AlertTriangle, Package, Clock, Bell } from 'lucide-react';
import { getTranslation } from '../../../utils/translations';

const NotificationsModal = ({ onClose }) => {
  const { state } = useApp();
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 400);
  }, [onClose]);

  const lowStockProducts = state.products.filter(p => (p.quantity || p.stock || 0) <= state.lowStockThreshold);
  const expiringProducts = state.products.filter(p => {
    if (!p.expiryDate) return false;
    const expiryDate = new Date(p.expiryDate);
    const now = new Date();
    const diffTime = expiryDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= state.expiryDaysThreshold;
  });

  const notifications = [
    ...lowStockProducts.map(product => ({
      type: 'low_stock',
      title: getTranslation('lowStockAlert', state.currentLanguage),
      message: `${product.name} ${getTranslation('isRunningLow', state.currentLanguage)} (${product.quantity || product.stock || 0} ${getTranslation('unitsRemaining', state.currentLanguage)})`,
      icon: Package,
      color: 'yellow'
    })),
    ...expiringProducts.map(product => ({
      type: 'expiring',
      title: getTranslation('expiringSoon', state.currentLanguage),
      message: `${product.name} ${getTranslation('expiresIn', state.currentLanguage)} ${Math.ceil((new Date(product.expiryDate) - new Date()) / (1000 * 60 * 60 * 24))} ${getTranslation('days', state.currentLanguage)}`,
      icon: Clock,
      color: 'red'
    }))
  ];

  if (typeof document === 'undefined') {
    return null;
  }

  const modalContent = (
    <div
      className={`fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[1050] p-0 sm:p-4 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleClose}
    >
      <style>{`
        @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
        @keyframes slideDown {
            from { transform: translateY(0); }
            to { transform: translateY(100%); }
        }
      `}</style>
      <div
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
        className="bg-white dark:bg-gray-800 rounded-none sm:rounded-2xl shadow-2xl w-full max-w-4xl h-auto max-h-[95vh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden transition-colors duration-200 relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Fixed Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50">
              <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">{getTranslation('notifications', state.currentLanguage)}</h2>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                {notifications.length} {notifications.length === 1 ? 'Alert' : 'Alerts'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
            aria-label="Close notifications"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 bg-gray-50/50 dark:bg-gray-900/50">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center h-full">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
                <AlertTriangle className="h-7 w-7 text-gray-300 dark:text-gray-600" />
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{getTranslation('noNotifications', state.currentLanguage)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {getTranslation('noNotificationsDetail', state.currentLanguage) || 'Come back later for low-stock or expiry alerts.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {notifications.map((notification, index) => {
                const Icon = notification.icon;
                const colorClasses = notification.color === 'yellow'
                  ? {
                    wrapper: 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30',
                    iconBox: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
                    title: 'text-amber-900 dark:text-amber-100',
                    text: 'text-amber-700 dark:text-amber-300'
                  }
                  : {
                    wrapper: 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/30',
                    iconBox: 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
                    title: 'text-rose-900 dark:text-rose-100',
                    text: 'text-rose-700 dark:text-rose-300'
                  };

                return (
                  <div
                    key={index}
                    className={`flex items-start gap-4 rounded-xl border px-4 py-4 transition hover:shadow-md ${colorClasses.wrapper}`}
                  >
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${colorClasses.iconBox}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h3 className={`text-sm font-semibold ${colorClasses.title}`}>{notification.title}</h3>
                      <p className={`text-sm leading-relaxed ${colorClasses.text}`}>{notification.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default NotificationsModal;
