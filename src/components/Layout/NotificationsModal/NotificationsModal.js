import React from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../../context/AppContext';
import { X, AlertTriangle, Package, Clock } from 'lucide-react';
import { getTranslation } from '../../../utils/translations';

const NotificationsModal = ({ onClose }) => {
  const { state } = useApp();

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-[0_20px_60px_-15px_rgba(15,23,42,0.45)] border border-slate-100">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Drag & Drop</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{getTranslation('notifications', state.currentLanguage)}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {notifications.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                <AlertTriangle className="h-7 w-7 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-500">{getTranslation('noNotifications', state.currentLanguage)}</p>
              <p className="text-xs text-slate-400">
                {getTranslation('noNotificationsDetail', state.currentLanguage) || 'Come back later for low-stock or expiry alerts.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {notifications.map((notification, index) => {
                const Icon = notification.icon;
                const colorClasses = notification.color === 'yellow'
                  ? {
                      wrapper: 'bg-amber-50 border-amber-200',
                      iconBox: 'bg-amber-100 text-amber-600'
                    }
                  : {
                      wrapper: 'bg-rose-50 border-rose-200',
                      iconBox: 'bg-rose-100 text-rose-600'
                    };

                return (
                  <div
                    key={index}
                    className={`flex items-start gap-4 rounded-2xl border px-4 py-4 transition hover:shadow-md ${colorClasses.wrapper}`}
                  >
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${colorClasses.iconBox}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h3 className="text-sm font-semibold text-slate-900">{notification.title}</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">{notification.message}</p>
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




