import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../../context/AppContext';
import { X, AlertTriangle, Package, Clock, Bell } from 'lucide-react';
import { getTranslation } from '../../../utils/translations';
import { calculateProductAlerts } from '../../../utils/productUtils';
import { getTotalStockQuantity, formatQuantityWithUnit } from '../../../utils/unitConversion';

const NotificationsModal = ({ onClose }) => {
  const { state } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 400);
  }, [onClose]);

  const { lowStockProducts, expiryAlerts } = calculateProductAlerts(state.products, state.lowStockThreshold, state.expiryDaysThreshold);

  // Categorize alerts
  const notifications = [
    // Critical: Expired
    ...expiryAlerts.filter(a => a.type === 'expired').map(alert => {
      const daysAgo = Math.abs(alert.days);
      const isMultiple = alert.count > 1;
      return {
        id: `exp-${alert.product.id || alert.product._id}`,
        type: 'expired',
        severity: 'critical',
        title: getTranslation('criticalAlertExpired', state.currentLanguage) || 'Critical Alert: Expired',
        message: isMultiple
          ? `${alert.product.name}: ${alert.count} batches expired (oldest ${daysAgo} days ago)`
          : `${alert.product.name} expired ${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago`,
        icon: AlertTriangle,
        color: 'red'
      };
    }),
    // Critical: Out of Stock
    ...lowStockProducts.filter(p => getTotalStockQuantity(p) <= 0).map(product => ({
      id: `oos-${product.id || product._id}`,
      type: 'out_of_stock',
      severity: 'critical',
      title: getTranslation('criticalAlertOutOfStock', state.currentLanguage) || 'Critical Alert: Out of Stock',
      message: `${product.name} is out of stock!`,
      icon: AlertTriangle,
      color: 'red'
    })),
    // Warning: Low Stock (quantity > 0)
    ...lowStockProducts.filter(p => getTotalStockQuantity(p) > 0).map(product => {
      const stockVal = getTotalStockQuantity(product);
      const formattedStock = formatQuantityWithUnit(stockVal, product.unit || product.sellingUnit || 'pcs');
      return {
        id: `low-${product.id || product._id}`,
        type: 'low_stock',
        severity: 'warning',
        title: getTranslation('warningAlertLowStock', state.currentLanguage) || 'Warning: Low Stock',
        message: `${product.name} ${getTranslation('isRunningLow', state.currentLanguage)} (${formattedStock} remaining)`,
        icon: Package,
        color: 'yellow'
      };
    }),
    // Warning: Expiring Soon
    ...expiryAlerts.filter(a => a.type === 'expiring').map(alert => {
      const isMultiple = alert.count > 1;
      return {
        id: `soon-${alert.product.id}`,
        type: 'expiring',
        severity: 'warning',
        title: getTranslation('warningAlertExpiring', state.currentLanguage) || 'Warning: Expiring Soon',
        message: isMultiple
          ? `${alert.product.name}: ${alert.count} batches expiring soon (earliest in ${alert.days} days)`
          : `${alert.product.name} ${getTranslation('expiresIn', state.currentLanguage)} ${alert.days} ${getTranslation('days', state.currentLanguage)}`,
        icon: Clock,
        color: 'yellow'
      };
    })
  ];

  const filteredNotifications = notifications.filter(n => filter === 'all' || n.severity === filter);

  const handleNotificationClick = (notification) => {
    let filterStatus = '';

    switch (notification.type) {
      case 'expired':
        filterStatus = 'expired';
        break;
      case 'expiring':
        filterStatus = 'expiry_soon';
        break;
      case 'low_stock':
        filterStatus = 'low_stock';
        break;
      case 'out_of_stock':
        filterStatus = 'out_of_stock';
        break;
      default:
        filterStatus = '';
    }

    if (filterStatus) {
      handleClose();
      // Navigate to products page with the filter
      navigate('/products', { state: { filterStatus } });
    }
  };

  if (typeof document === 'undefined') {
    return null;
  }

  const modalContent = (
    <div
      className={`fixed inset-0 bg-gray-900/60 flex items-end md:items-center justify-center z-[1050] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
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
        className="bg-white dark:bg-black !rounded-none md:!rounded-2xl shadow-2xl w-full max-w-4xl !h-full md:!h-auto md:max-h-[85vh] flex flex-col overflow-hidden transition-colors duration-200 fixed inset-0 md:relative md:inset-auto m-0 border dark:border-white/10"
        onClick={e => e.stopPropagation()}
      >
        {/* Fixed Header */}
        <div className="flex flex-col border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <div className="flex items-center justify-between px-4 sm:px-6 py-4">
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

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 px-4 sm:px-6 pb-4 overflow-x-auto no-scrollbar">
            {['all', 'critical', 'warning'].map(type => {
              const count = notifications.filter(n => type === 'all' || n.severity === type).length;
              const isActive = filter === type;

              let activeClass = 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';
              if (type === 'critical') activeClass = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800';
              if (type === 'warning') activeClass = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';

              return (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${isActive
                    ? activeClass
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-400 dark:border-white/10 dark:hover:bg-white/10'
                    }`}
                >
                  {getTranslation(type, state.currentLanguage)} <span className="opacity-75">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 bg-gray-50/50 dark:bg-black">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center h-full">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5 mb-4">
                <AlertTriangle className="h-7 w-7 text-gray-300 dark:text-gray-600" />
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {filter === 'all' ? getTranslation('noNotifications', state.currentLanguage) : `No ${filter} alerts`}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {getTranslation('noNotificationsDetail', state.currentLanguage) || 'Come back later for alerts.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredNotifications.map((notification, index) => {
                const Icon = notification.icon;
                const colorClasses = notification.color === 'yellow'
                  ? {
                    wrapper: 'bg-amber-50 dark:bg-black border-amber-200 dark:border-amber-500/20',
                    iconBox: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
                    title: 'text-amber-900 dark:text-amber-100',
                    text: 'text-amber-700 dark:text-amber-300'
                  }
                  : {
                    wrapper: 'bg-rose-50 dark:bg-black border-rose-200 dark:border-rose-500/20',
                    iconBox: 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
                    title: 'text-rose-900 dark:text-rose-100',
                    text: 'text-rose-700 dark:text-rose-300'
                  };

                return (
                  <div
                    key={index}
                    onClick={() => handleNotificationClick(notification)}
                    className={`flex items-start gap-4 rounded-xl border px-4 py-4 transition hover:shadow-md cursor-pointer ${colorClasses.wrapper}`}
                  >
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${colorClasses.iconBox}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h3 className={`text-sm font-semibold ${colorClasses.title} flex items-center gap-2`}>
                        {notification.title}
                        {notification.severity === 'critical' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200 uppercase tracking-wider">
                            Critical
                          </span>
                        )}
                      </h3>
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
