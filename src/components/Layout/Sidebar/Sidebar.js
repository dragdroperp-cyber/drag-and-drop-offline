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
  Lock,
  History,
  RotateCcw,
  UserCheck
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
  // Settings are always unlocked for all users, regardless of plan status or user type
  const isSettingsUnlocked = true;
  const isStaffUser = state.userType === 'staff' || state.currentUser?.userType === 'staff';
  const staffPermissions = state.currentUser?.permissions || {};
  const staffPermissionsLoading = state.staffPermissionsLoading;


  // Debug staff permissions state (commented out to prevent spam)
  // React.useEffect(() => {
  //   if (isStaffUser) {
  //     console.log('🔍 SIDEBAR STAFF DEBUG:', {
  //       isStaffUser,
  //       staffPermissionsLoading,
  //       staffPermissionsKeys: Object.keys(staffPermissions),
  //       hasPermissions: Object.keys(staffPermissions).length > 0
  //     });
  //   }
  // }, [isStaffUser, staffPermissionsLoading, Object.keys(staffPermissions).sort().join(',')]);

  // Base navigation items
  let navigation = [
    { name: 'dashboard', href: 'dashboard', icon: LayoutDashboard },
    { name: 'customers', href: 'customers', icon: Users },
    { name: 'products', href: 'products', icon: Package },
    { name: 'inventory', href: 'inventory', icon: Warehouse },
    { name: 'billing', href: 'billing', icon: Receipt },
    { name: 'salesOrderHistory', href: 'salesOrderHistory', icon: History },
    { name: 'refunds', href: 'refunds', icon: RotateCcw },
    { name: 'purchaseOrders', href: 'purchase', icon: Truck },
    // Only show staff management to sellers, not to staff users
    ...(isStaffUser ? [] : [{ name: 'staff', href: 'staff', icon: UserCheck }]),
    { name: 'financial', href: 'financial', icon: Wallet },
    { name: 'reports', href: 'reports', icon: BarChart3 },
    // Show upgrade plan to staff users only if they have upgrade permission
    ...(isStaffUser ? (staffPermissions.upgradePlan === true ? [{ name: 'upgradePlan', href: 'upgrade', icon: Crown }] : []) : [{ name: 'upgradePlan', href: 'upgrade', icon: Crown }]),
  ];

  // For staff users, filter navigation based on permissions
  if (isStaffUser && !staffPermissionsLoading && Object.keys(staffPermissions).length > 0) {
    // Permissions loaded from IndexedDB, filter navigation to show only allowed items
    navigation = navigation.filter(item => {
      // Each navigation item requires its own permission
      // Settings is removed - staff always have access without permission
      const permissionMap = {
        'dashboard': 'dashboard',
        'customers': 'customers',
        'products': 'products',
        'inventory': 'inventory',
        'billing': 'billing',
        'salesOrderHistory': 'salesOrderHistory', // Now requires its own permission
        'refunds': 'refunds',
        'purchase': 'purchaseOrders',
        'financial': 'financial',
        'reports': 'reports',
        'upgrade': 'upgradePlan'
        // 'settings': removed - staff always have access without permission
      };

      const requiredPermission = permissionMap[item.href] || item.href;
      return staffPermissions[requiredPermission] === true;
    });
  }
  // If permissions are still loading or not available, show all navigation items initially
  // They will be filtered once permissions are loaded from IndexedDB

  const handleNavigation = (view) => {
    const isStaffUser = state.userType === 'staff' || state.currentUser?.userType === 'staff';

    if (isStaffUser) {
      // Settings are always accessible for staff - skip all permission checks
      if (view === 'settings') {
        // Settings always allowed for staff
      } else {
        // For other views, check permissions for staff users
        const permissions = state.currentUser?.permissions || {};

        // Each navigation item requires its own permission
        const permissionMap = {
          'dashboard': 'dashboard',
          'customers': 'customers',
          'products': 'products',
          'inventory': 'inventory',
          'billing': 'billing',
          'salesOrderHistory': 'salesOrderHistory', // Now requires its own permission
          'refunds': 'refunds',
          'purchase': 'purchaseOrders',
          'financial': 'financial',
          'reports': 'reports',
          'upgrade': 'upgradePlan'
        };

        const requiredPermission = permissionMap[view] || view;
        const hasPermission = permissions[requiredPermission] === true;

        if (!hasPermission) {
          if (window.showToast) {
            window.showToast('You do not have permission to access this feature.', 'warning');
          }
          return;
        }
      }
    } else {
      // For seller users, use existing logic
      if (planExpired && view !== 'upgrade') {
        if (window.showToast) window.showToast(planExpiredMessage, 'warning');
        return;
      }

      if (view !== 'dashboard' && view !== 'settings' && !isModuleUnlocked(view, state.currentPlan, state.currentPlanDetails)) {
        const message = getUpgradeMessage(view, state.currentPlan);
        if (window.showToast) {
          window.showToast(message, 'warning');
        }
        return;
      }
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
            let isUnlocked;

            if (isStaffUser) {
              // For staff users, navigation is already filtered by permissions,
              // but we still check seller's plan to ensure staff can't access modules
              // that the seller's plan doesn't support
              const hasPermission = staffPermissions[item.href === 'purchase' ? 'purchaseOrders' : item.href] === true;
              const sellerAllows = item.href === 'dashboard' || item.href === 'upgrade'
                ? true
                : isModuleUnlocked(item.href, state.currentPlan, state.currentPlanDetails);
              isUnlocked = hasPermission && (planExpired ? isUpgradePage : sellerAllows);
            } else {
              // For sellers, use existing logic
              const baseUnlocked = item.href === 'dashboard'
                ? true
                : isModuleUnlocked(item.href, state.currentPlan, state.currentPlanDetails);
              isUnlocked = planExpired ? isUpgradePage : baseUnlocked;
            }
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
