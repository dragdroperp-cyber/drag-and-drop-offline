import React, { useCallback, useMemo, useEffect, useState } from 'react';
import { useApp, ActionTypes } from '../../../context/AppContext';
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
  RotateCcw
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

const Sidebar = React.memo(({ onClose }) => {
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
  const planExpired = useMemo(() =>
    state.isSubscriptionActive === false ||
    subscriptionStatus === 'expired' ||
    (subscriptionExpiryDate ? subscriptionExpiryDate.getTime() <= Date.now() : false),
    [state.isSubscriptionActive, subscriptionStatus, subscriptionExpiryDate]
  );

  const planExpiredMessage = 'Your subscription has expired. Upgrade your plan to continue.';
  // Settings, dashboard, and upgrade are always unlocked for all users, regardless of plan status
  // Base navigation items - show all but lock unavailable ones
  const navigation = useMemo(() => [
    { name: 'dashboard', href: 'dashboard', icon: LayoutDashboard },
    { name: 'customers', href: 'customers', icon: Users },
    { name: 'products', href: 'products', icon: Package },
    { name: 'inventory', href: 'inventory', icon: Warehouse },
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

    // Block dashboard for expired plans
    if (view === 'dashboard' && planExpired) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade to access the dashboard.', 'warning');
      }
      // Navigate to upgrade page instead
      const path = getPathForView('upgrade');
      dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: 'upgrade' });
      navigate(path);
      if (onClose) onClose();
      return;
    }

    // Always check plan unlocks for non-basic views (dashboard, settings, and upgrade are always accessible)
    // Lock everything except essential views while plan details are loading or invalid
    const shouldBlockNavigation = (view !== 'dashboard' && view !== 'settings' && view !== 'upgrade') &&
      (isPlanInfoLoading || !hasValidPlanDetails || !isModuleUnlocked(view, state.currentPlan, state.currentPlanDetails));

    if (shouldBlockNavigation) {
      const message = isPlanInfoLoading
        ? 'Loading plan details...'
        : !hasValidPlanDetails
          ? 'Plan details not available'
          : getUpgradeMessage(view, state.currentPlan);
      if (window.showToast) {
        window.showToast(message, 'warning');
      }
      return;
    }

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
    if (!isUnlocked) {
      return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-400 dark:text-slate-600 cursor-not-allowed border border-transparent';
    }

    if (isActive) {
      return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow-lg border border-transparent';
    }

    if (isUpgrade) {
      return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 transition-all duration-200 border border-transparent hover:bg-white/70 dark:hover:bg-slate-800/50 hover:text-[#2f3c7e] dark:hover:text-indigo-400';
    }

    return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 transition-all duration-200 border border-transparent hover:bg-white/70 dark:hover:bg-slate-800/50 hover:text-[#2f3c7e] dark:hover:text-indigo-400';
  }, []);

  const getIconClass = useCallback((isActive, isUnlocked) => {
    if (!isUnlocked) return 'h-5 w-5 text-slate-300 dark:text-slate-700';
    return isActive ? 'h-5 w-5 text-white' : 'h-5 w-5 text-slate-500 dark:text-slate-400 group-hover:text-[#2f3c7e] dark:group-hover:text-indigo-400';
  }, []);

  const logoSrc = useMemo(() => `${process.env.PUBLIC_URL || ''}/assets/drag-and-drop-logo-croped.jpg`, []);
  const fallbackLogoSrc = useMemo(() => `${process.env.PUBLIC_URL || ''}/assets/drag-drop-logo.png`, []);

  const handleLogoError = useCallback((e) => {
    e.currentTarget.src = fallbackLogoSrc;
  }, [fallbackLogoSrc]);

  return (
    <div className="dark-sidebar flex h-full flex-col" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="flex items-center justify-between px-5 py-5 flex-shrink-0 border-b border-slate-200/50 dark:border-slate-700/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="mx-auto flex h-10 w-12 items-center justify-center rounded-2xl bg-transparent overflow-hidden">
            <img
              src={logoSrc}
              alt="Drag & Drop"
              className="h-9 w-12 object-cover"
              onError={handleLogoError}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Drag &amp; Drop</p>
            <h1 className="truncate text-lg font-semibold text-slate-800 dark:text-slate-100">Grocery Studio</h1>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="xl:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
        <ul className="pb-6 pt-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = state.currentView === item.href;
            const isUpgradePage = item.href === 'upgrade';

            // Always check module unlocks based on current plan details
            // Lock all modules (except essential ones) until plan details are loaded and valid
            const isPlanInfoLoading = state.currentPlanDetails === null;
            const hasValidPlanDetails = state.currentPlanDetails &&
              state.currentPlanDetails.unlockedModules &&
              Array.isArray(state.currentPlanDetails.unlockedModules);

            // Check if dashboard should be locked due to expired plan
            const isDashboardLocked = item.href === 'dashboard' && planExpired;

            const isUnlocked = isDashboardLocked
              ? false // Lock dashboard for expired plans
              : (item.href === 'dashboard' || item.href === 'settings' || item.href === 'upgrade')
                ? true // These are always unlocked (except dashboard for expired plans)
                : isPlanInfoLoading || !hasValidPlanDetails
                  ? false // Lock everything else while loading or if no valid plan details
                  : isModuleUnlocked(item.href, state.currentPlan, state.currentPlanDetails);



            const buttonTitle = !isUnlocked
              ? getUpgradeMessage(item.href, state.currentPlan)
              : undefined;

            return (
              <li key={item.name} className="px-3 py-1">
                <button
                  onClick={() => handleNavigation(item.href)}
                  className={getNavButtonClass(isActive, isUnlocked, isUpgradePage)}
                  title={buttonTitle}
                  disabled={!isUnlocked}
                >
                  <Icon className={getIconClass(isActive, isUnlocked)} />
                  <span className="truncate">
                    {getTranslation(item.name, state.currentLanguage)}
                  </span>
                  {!isUnlocked && (
                    <Lock className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                  )}
                  {isUpgradePage && (
                    <Crown className="h-4 w-4 text-amber-400" />
                  )}
                </button>
              </li>
            );
          })}


          {/* Settings button - always shown for all users regardless of plan or permissions */}
          <li className="px-3 py-1">
            <button
              onClick={() => handleNavigation('settings')}
              className={getNavButtonClass(
                state.currentView === 'settings',
                true, // Settings are always unlocked for all users
                false
              )}
              disabled={false} // Settings are never disabled
            >
              <Settings className={getIconClass(
                state.currentView === 'settings',
                true // Settings are always unlocked for all users
              )} />
              <span className="truncate">{getTranslation('settings', state.currentLanguage)}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
