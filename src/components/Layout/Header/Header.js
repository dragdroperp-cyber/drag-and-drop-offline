import React, { useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { Menu, Bell, Clock, Download } from 'lucide-react';
import NotificationsModal from '../NotificationsModal/NotificationsModal';
import { getTranslation } from '../../../utils/translations';

const Header = ({ onMenuClick, installState = {} }) => {
  const { state } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const { isInstallable, isInstalled, install } = installState;

  const getViewTitle = (view) => getTranslation(view, state.currentLanguage);

  const lowStockCount = state.products.filter(p => (p.quantity || p.stock || 0) <= state.lowStockThreshold).length;
  const expiringCount = state.products.filter(p => {
    if (!p.expiryDate) return false;
    const expiryDate = new Date(p.expiryDate);
    const now = new Date();
    const diffTime = expiryDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= state.expiryDaysThreshold;
  }).length;
  const totalAlerts = lowStockCount + expiringCount;

  return (
    <header className="relative overflow-hidden border-b border-slate-800 bg-slate-950/95 px-3  text-white sm:px-4 sm:py-3 lg:px-6 lg:py-3.5">
      <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-white/5 opacity-40 pointer-events-none" />

      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <button
            onClick={onMenuClick}
            className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/70">
              {getViewTitle(state.currentView)}
            </div>
            <h1 className="mt-1.5 text-lg font-semibold sm:text-xl lg:text-[24px] lg:tracking-tight">
              {getViewTitle(state.currentView)}
            </h1>
            <div className="mt-1.5 hidden items-center gap-2 text-xs text-white/70 sm:flex">
              <Clock className="h-4 w-4 shrink-0" />
              <span className="font-mono text-sm font-semibold tracking-wide text-white/90">
                {state.currentTime}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2.5">
          {isInstallable && !isInstalled && (
            <button
              onClick={install}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              title="Install App"
            >
              <Download className="h-4 w-4" />
              <span>Install App</span>
            </button>
          )}

          <button
            onClick={() => setShowNotifications(true)}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20"
            aria-label="View notifications"
          >
            <Bell className="h-5 w-5" />
            {totalAlerts > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white shadow-lg">
                {totalAlerts}
              </span>
            )}
          </button>

          <div className="hidden items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-left sm:flex">
            <div className="leading-tight text-white/80">
              <p className="text-[9px] font-semibold uppercase tracking-[0.26em]">User</p>
              <p className="text-sm font-semibold text-white leading-tight">
                {state.currentUser?.username || 'User'}
              </p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/30 bg-white/10">
              <img
                className="h-full w-full object-cover"
                src={state.currentUser?.photoURL || `https://placehold.co/80x80/1b1b1b/ffffff?text=${state.currentUser?.username?.charAt(0).toUpperCase() || 'U'}`}
                alt="User avatar"
                onError={(e) => {
                  e.currentTarget.src = `https://placehold.co/80x80/1b1b1b/ffffff?text=${state.currentUser?.username?.charAt(0).toUpperCase() || 'U'}`;
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {showNotifications && (
        <NotificationsModal onClose={() => setShowNotifications(false)} />
      )}
    </header>
  );
};

export default Header;
