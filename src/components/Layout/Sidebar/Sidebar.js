import React, { useCallback, useMemo, useEffect, useState } from 'react';
import { useApp, ActionTypes, isPlanExpired } from '../../../context/AppContext';
import {
  LayoutDashboard,
  Users,
  Receipt,
  Package,
  Truck,
  BarChart3,
  Crown,
  Settings,
  X,
  Warehouse,
  Wallet,
  IndianRupee,
  CreditCard,
  Lock,
  History,
  RotateCcw,
  Share2,

} from 'lucide-react';
import { getTranslation } from '../../../utils/translations';
import { isModuleUnlocked, getUpgradeMessage } from '../../../utils/planUtils';
import { getPathForView } from '../../../utils/navigation';
import { useNavigate } from 'react-router-dom';

const parseExpiryDate = (rawValue) => {
  if (!rawValue) return null;
  const parsedDate = new Date(rawValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const getSubscriptionExpiryDate = (state) => {
  if (!state) return null;
  const rawValue =
    state.subscription?.expiresAt ||
    state.subscription?.expiryDate ||
    state.subscription?.endDate ||
    state.currentPlanDetails?.expiresAt ||
    state.currentPlanDetails?.expiryDate ||
    state.currentPlanDetails?.endDate ||
    null;
  return parseExpiryDate(rawValue);
};

const Sidebar = React.memo(({ onClose, isMinimized = false }) => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();

  // Force re-render when plan details change
  const [planDetailsKey, setPlanDetailsKey] = useState(0);

  // Force re-render when plan details change
  useEffect(() => {
    // Force component update by changing a local state
    setPlanDetailsKey(prev => prev + 1);
  }, [state.currentPlan, state.currentPlanDetails?.unlockedModules, state.isSubscriptionActive]);
  const subscriptionExpiryDate = useMemo(() => getSubscriptionExpiryDate(state), [state]);
  const subscriptionStatus = useMemo(() =>
    typeof state.subscription?.status === 'string'
      ? state.subscription.status.toLowerCase()
      : null,
    [state.subscription?.status]
  );
  const planExpired = useMemo(() => isPlanExpired(state), [state]);

  const planExpiredMessage = 'Your subscription has expired. Upgrade your plan to continue.';
  // Settings, dashboard, and upgrade are always unlocked for all users, regardless of plan status
  // Base navigation items - show all but lock unavailable ones
  const navigation = useMemo(() => [
    { name: 'dashboard', href: 'dashboard', icon: LayoutDashboard },
    { name: 'customers', href: 'customers', icon: Users },
    { name: 'products', href: 'products', icon: Package },

    { name: 'billing', href: 'billing', icon: CreditCard },
    { name: 'salesOrderHistory', href: 'salesOrderHistory', icon: History },
    { name: 'refunds', href: 'refunds', icon: RotateCcw },
    { name: 'purchaseOrders', href: 'purchase', icon: Truck },
    { name: 'financial', href: 'financial', icon: IndianRupee },
    { name: 'reports', href: 'reports', icon: BarChart3 },

    { name: 'upgradePlan', href: 'upgrade', icon: Crown },
  ], []);

  const handleNavigation = useCallback((view) => {
    const isPlanInfoLoading = state.currentPlanDetails === null;

    const hasValidPlanDetails = state.currentPlanDetails &&
      state.currentPlanDetails.unlockedModules &&
      Array.isArray(state.currentPlanDetails.unlockedModules);



    // Always check plan unlocks for non-basic views (dashboard, settings, upgrade are always accessible)
    // Lock everything except essential views while plan details are loading or invalid
    // Navigation blocking removed to allow read-only access to all modules under any condition
    // Write operations are still protected at the enhancedDispatch level
    const shouldBlockNavigation = false;

    const path = getPathForView(view);
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(path);
    if (onClose) onClose();
  }, [state.currentPlanDetails, state.currentPlan, planExpired, dispatch, navigate, onClose]);

  // Preload critical images on component mount
  useEffect(() => {
    const { preloadCriticalImages } = require('../../../utils/imageOptimization');
    preloadCriticalImages();
  }, []);

  const getNavButtonClass = useCallback((isActive, isUnlocked, isUpgrade) => {
    const baseClasses = `group flex w-full items-center ${isMinimized ? 'justify-center px-2' : 'gap-3 px-4'} rounded-2xl py-3 text-sm font-medium transition-all duration-200 border border-transparent`;

    if (!isUnlocked) {
      return `${baseClasses} text-slate-400 dark:text-slate-600 cursor-not-allowed`;
    }

    if (isActive) {
      return `${baseClasses} bg-gradient-to-r from-slate-900 to-slate-900 text-white shadow-lg`;
    }

    if (isUpgrade) {
      return `${baseClasses} text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-indigo-400`;
    }

    return `${baseClasses} text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-indigo-400`;
  }, [isMinimized]);

  const getIconClass = useCallback((isActive, isUnlocked) => {
    if (!isUnlocked) return 'h-5 w-5 text-slate-300 dark:text-slate-700 flex-shrink-0';
    return isActive ? 'h-5 w-5 text-white flex-shrink-0' : 'h-5 w-5 text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-indigo-400 flex-shrink-0';
  }, []);

  const logoSrc = useMemo(() => `${process.env.PUBLIC_URL || ''}/assets/drag-and-drop-logo-croped.jpg`, []);
  const fallbackLogoSrc = useMemo(() => `${process.env.PUBLIC_URL || ''}/assets/drag-drop-logo.png`, []);

  const handleLogoError = useCallback((e) => {
    e.currentTarget.src = fallbackLogoSrc;
  }, [fallbackLogoSrc]);

  return (
    <div className={`dark-sidebar flex h-full flex-col transition-all duration-300 ${isMinimized ? 'items-center' : ''}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className={`flex items-center ${isMinimized ? 'justify-center px-2' : 'justify-between px-5'} py-5 flex-shrink-0 border-b border-slate-200/50 dark:border-slate-700/50 transition-all duration-300`}>
        <div className={`flex items-center ${isMinimized ? 'justify-center' : 'gap-3'} min-w-0`}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-transparent overflow-hidden flex-shrink-0">
            <img
              src={logoSrc}
              alt="Drag & Drop"
              className="h-full w-full object-cover"
              onError={handleLogoError}
            />
          </div>
          {!isMinimized && (
            <div className="min-w-0 transition-opacity duration-300">
              <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Drag &amp; Drop</p>
              <h1 className="truncate text-lg font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">Grocery Studio</h1>
              {planExpired && (
                <div className="mt-1 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/30 text-[10px] font-bold text-rose-600 dark:text-rose-400 w-fit">
                  <Lock className="h-3 w-3" />
                  <span>EXPIRED</span>
                </div>
              )}
            </div>
          )}
        </div>
        {!isMinimized && onClose && (
          <button
            onClick={onClose}
            className="xl:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
        <ul className={`pb-6 pt-2 ${isMinimized ? 'px-2' : ''}`}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = state.currentView === item.href;
            const isUpgradePage = item.href === 'upgrade';
            const finalIsUnlocked = true;

            const buttonTitle = isMinimized
              ? getTranslation(item.name, state.currentLanguage)
              : (!finalIsUnlocked ? getUpgradeMessage(item.href, state.currentPlan) : undefined);

            return (
              <li key={item.name} className={`${isMinimized ? 'px-0' : 'px-3'} py-1`}>
                <button
                  onClick={() => handleNavigation(item.href)}
                  className={getNavButtonClass(isActive, finalIsUnlocked, isUpgradePage)}
                  title={buttonTitle}
                  disabled={!finalIsUnlocked}
                >
                  <Icon className={getIconClass(isActive, finalIsUnlocked)} />
                  {!isMinimized && (
                    <>
                      <span className="truncate capitalize flex-1 text-left">
                        {getTranslation(item.name, state.currentLanguage)}
                      </span>
                      {!finalIsUnlocked && (
                        <Lock className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                      )}
                      {isUpgradePage && (
                        <Crown className="h-4 w-4 text-amber-400" />
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}


          {/* Settings button - always shown for all users regardless of plan or permissions */}
          <li className={`${isMinimized ? 'px-0' : 'px-3'} py-1`}>
            <button
              onClick={() => handleNavigation('settings')}
              className={getNavButtonClass(
                state.currentView === 'settings',
                true, // Settings are always unlocked for all users
                false
              )}
              disabled={false} // Settings are never disabled
              title={isMinimized ? getTranslation('settings', state.currentLanguage) : undefined}
            >
              <Settings className={getIconClass(
                state.currentView === 'settings',
                true // Settings are always unlocked for all users
              )} />
              {!isMinimized && (
                <span className="truncate capitalize flex-1 text-left">{getTranslation('settings', state.currentLanguage)}</span>
              )}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
