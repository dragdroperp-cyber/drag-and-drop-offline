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
  DollarSign,
  Lock
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
  const planExpiredMessage = 'Your subscription has expired. Upgrade your plan to continue.';
  const settingsModuleUnlocked = isModuleUnlocked('settings', state.currentPlan, state.currentPlanDetails);
  const isSettingsUnlocked = planExpired ? false : settingsModuleUnlocked;

  const navigation = [
    { name: 'dashboard', href: 'dashboard', icon: LayoutDashboard },
    { name: 'customers', href: 'customers', icon: Users },
    { name: 'products', href: 'products', icon: Package },
    { name: 'inventory', href: 'inventory', icon: Warehouse },
    { name: 'billing', href: 'billing', icon: Receipt },
    { name: 'purchaseOrders', href: 'purchase', icon: Truck },
    { name: 'financial', href: 'financial', icon: DollarSign },
    { name: 'reports', href: 'reports', icon: BarChart3 },
    { name: 'upgradePlan', href: 'upgrade', icon: Crown },
  ];

  const handleNavigation = (view) => {
    if (planExpired && view !== 'upgrade') {
      if (window.showToast) window.showToast(planExpiredMessage, 'warning');
      return;
    }

    if (view !== 'dashboard' && !isModuleUnlocked(view, state.currentPlan, state.currentPlanDetails)) {
      const message = getUpgradeMessage(view, state.currentPlan);
      if (window.showToast) {
        const isSettingsMessage = view === 'settings';
        const hasSettingsAccess = settingsModuleUnlocked || planExpired;
        if (!(isSettingsMessage && hasSettingsAccess)) {
          window.showToast(message, 'warning');
        }
      }
      return;
    }

    const path = getPathForView(view);
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(path);
    if (onClose) onClose();
  };

  const logoSrc = `${process.env.PUBLIC_URL || ''}/assets/drag-and-drop-logo.jpg`;

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
    <div className="dark-sidebar flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
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
            className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <ul className="flex-1 overflow-y-auto pb-6 pt-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = state.currentView === item.href;
          const isUpgradePage = item.href === 'upgrade';
          const baseUnlocked = item.href === 'dashboard'
            ? true
            : isModuleUnlocked(item.href, state.currentPlan, state.currentPlanDetails);
          const isUnlocked = planExpired ? isUpgradePage : baseUnlocked;
          const buttonTitle = !isUnlocked
            ? planExpired && !isUpgradePage
              ? planExpiredMessage
              : getUpgradeMessage(item.href, state.currentPlan)
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
 
        <li className="px-3 py-1">
          <button
            onClick={() => handleNavigation('settings')}
            title={
              planExpired
                ? planExpiredMessage
                : !settingsModuleUnlocked
                ? getUpgradeMessage('settings', state.currentPlan)
                : undefined
            }
            className={getNavButtonClass(state.currentView === 'settings', isSettingsUnlocked, false)}
            disabled={!isSettingsUnlocked}
          >
            <Settings className={getIconClass(state.currentView === 'settings', isSettingsUnlocked)} />
            <span className="truncate">{getTranslation('settings', state.currentLanguage)}</span>
            {!isSettingsUnlocked && (
              <Lock className="h-4 w-4 text-slate-300" />
            )}
          </button>
        </li>
      </ul>
    </div>
  );
};

export default Sidebar;
