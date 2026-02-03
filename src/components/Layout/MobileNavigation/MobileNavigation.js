import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../../context/AppContext';
import {
  LayoutDashboard,
  Users,
  Receipt,
  Package,
  Warehouse,
  Truck,
  Wallet,
  BarChart3,
  Crown,
  History,
  RotateCcw,
  Store
} from 'lucide-react';
import { isModuleUnlocked, getUpgradeMessage } from '../../../utils/planUtils';
import { getPathForView } from '../../../utils/navigation';

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

const MobileNavigation = () => {
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
  console.log('📱 MOBILE NAV PLAN EXPIRY DEBUG:', {
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

  const navigation = [
    { name: 'Dashboard', href: 'dashboard', icon: LayoutDashboard },
    { name: 'Customers', href: 'customers', icon: Users },
    { name: 'Products', href: 'products', icon: Package },
    { name: 'Coming Soon', href: 'onlineStore', icon: Store, disabled: true },
    { name: 'Billing', href: 'billing', icon: Receipt },
    { name: 'Sales History', href: 'salesOrderHistory', icon: History },
    { name: 'Refunds', href: 'refunds', icon: RotateCcw },
    { name: 'Purchase', href: 'purchase', icon: Truck },
    { name: 'Financial', href: 'financial', icon: Wallet },
    { name: 'Reports', href: 'reports', icon: BarChart3 },
    { name: 'Upgrade', href: 'upgrade', icon: Crown },
  ];

  const handleNavigation = (view) => {
    // Check if the item is disabled first
    const item = navigation.find(n => n.href === view);
    if (item?.disabled) return;

    // Allow all navigation for expired plans - they can view data but backend blocks operations

    // Check plan unlocks for non-basic views (only when plan is not expired)
    if (!planExpired && view !== 'dashboard' && !isModuleUnlocked(view, state.currentPlan, state.currentPlanDetails)) {
      if (window.showToast) window.showToast(getUpgradeMessage(view, state.currentPlan), 'warning');
      return;
    }

    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(getPathForView(view));
  };

  return (
    <div className="hidden sm:block xl:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
      <div className="flex justify-around py-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = state.currentView === item.href;
          const isUpgrade = item.href === 'upgrade';
          // Allow all navigation for expired plans - they can view data but backend blocks operations
          // Also allow all navigation while plan details are loading
          const isUnlocked = !item.disabled;
          return (
            <button
              key={item.name}
              onClick={() => handleNavigation(item.href)}
              className={`flex flex-col items-center p-2 text-xs font-medium transition-colors ${isActive
                ? 'text-green-600'
                : isUnlocked ? 'text-gray-500 hover:text-gray-700' : 'text-gray-400 opacity-50 cursor-not-allowed'
                }`}
              disabled={!isUnlocked}
            >
              <Icon className="h-5 w-5 mb-1" />
              <span className="truncate">{item.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MobileNavigation;
