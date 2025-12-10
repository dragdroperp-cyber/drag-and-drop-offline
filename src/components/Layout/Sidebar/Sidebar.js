import React from 'react';
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

const Sidebar = ({ onClose }) => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const subscriptionExpiryDate = getSubscriptionExpiryDate(state);
  const subscriptionStatus = typeof state.subscription?.status === 'string'
    ? state.subscription.status.toLowerCase()
    : null;
  const planExpired = state.isSubscriptionActive === false ||
    subscriptionStatus === 'expired' ||
    (subscriptionExpiryDate ? subscriptionExpiryDate.getTime() <= Date.now() : false);

  // Debug logging for plan expiry detection
  console.log('🔒 SIDEBAR PLAN EXPIRY DEBUG:', {
    isSubscriptionActive: state.isSubscriptionActive,
    subscriptionStatus,
    subscriptionExpiryDate: subscriptionExpiryDate?.toISOString(),
    currentTime: new Date().toISOString(),
    expiryCheck: subscriptionExpiryDate ? subscriptionExpiryDate.getTime() <= Date.now() : false,
    planExpired,
    currentPlan: state.currentPlan,
    currentPlanDetails: state.currentPlanDetails
  });

  const planExpiredMessage = 'Your subscription has expired. Upgrade your plan to continue.';
  // Settings are always unlocked for all users, regardless of plan status or user type
  const isSettingsUnlocked = true;
  // Base navigation items - show all but lock unavailable ones
  let navigation = [
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
  ];

  const handleNavigation = (view) => {
    console.log('🔄 SIDEBAR NAVIGATION:', {
      view,
      planExpired,
      currentPlan: state.currentPlan,
      currentPlanDetails: state.currentPlanDetails,
      isModuleUnlocked: isModuleUnlocked(view, state.currentPlan, state.currentPlanDetails)
    });

    // Allow all navigation for expired plans - they can view data but backend blocks operations

    // Check plan unlocks for non-basic views (only when plan is not expired)
    if (!planExpired && view !== 'dashboard' && view !== 'settings' && !isModuleUnlocked(view, state.currentPlan, state.currentPlanDetails)) {
      const message = getUpgradeMessage(view, state.currentPlan);
      console.log('🚫 SIDEBAR BLOCKED:', { view, message });
      if (window.showToast) {
        window.showToast(message, 'warning');
      }
      return;
    }

    console.log('✅ SIDEBAR ALLOWED:', { view });
    const path = getPathForView(view);
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(path);
    if (onClose) onClose();
  };

  const logoSrc = `${process.env.PUBLIC_URL || ''}/assets/drag-and-drop-logo.jpg`;

  // Preload critical images on component mount
  React.useEffect(() => {
    const { preloadCriticalImages } = require('../../../utils/imageOptimization');
    preloadCriticalImages();
  }, []);

  const getNavButtonClass = (isActive, isUnlocked, isUpgrade) => {
    if (!isUnlocked) {
      return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-400 cursor-not-allowed border border-transparent';
    }

    if (isActive) {
      return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow-lg border border-transparent';
    }

    if (isUpgrade) {
      return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-600 transition-all duration-200 border border-transparent hover:bg-white/70 hover:text-[#2f3c7e]';
    }

    return 'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-600 transition-all duration-200 border border-transparent hover:bg-white/70 hover:text-[#2f3c7e]';
  };

  const getIconClass = (isActive, isUnlocked) => {
    if (!isUnlocked) return 'h-5 w-5 text-slate-300';
    return isActive ? 'h-5 w-5 text-white' : 'h-5 w-5 text-slate-500 group-hover:text-[#2f3c7e]';
  };

  return (
    <div className="dark-sidebar flex h-full flex-col" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="flex items-center justify-between px-5 py-5 flex-shrink-0 border-b border-slate-200/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/40 bg-white shadow-lg">
            <img src={logoSrc} alt="Drag & Drop" className="h-8 w-8 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500">Drag &amp; Drop</p>
            <h1 className="truncate text-lg font-semibold text-slate-800">Business OS</h1>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="xl:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
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

            // Allow all navigation for expired plans - they can view data but backend blocks operations
            // Also allow all navigation while plan details are loading
            const isPlanInfoLoading = state.currentPlanDetails === null;
            const isUnlocked = planExpired || isPlanInfoLoading
              ? true // All items unlocked for expired plans or while loading
              : (item.href === 'dashboard'
                ? true
                : isModuleUnlocked(item.href, state.currentPlan, state.currentPlanDetails));

            // Debug logging for upgrade item
            if (item.href === 'upgrade') {
              console.log('🎯 SIDEBAR UPGRADE ITEM:', {
                href: item.href,
                planExpired,
                isPlanInfoLoading,
                isUnlocked,
                currentPlan: state.currentPlan,
                currentPlanDetails: state.currentPlanDetails
              });
            }

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
                    <Lock className="h-4 w-4 text-slate-300" />
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
};

export default Sidebar;
