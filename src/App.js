import React, { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Login from './components/Login/Login';
import Layout from './components/Layout/Layout';
import SellerRegistrationForm from './components/Onboarding/SellerRegistrationForm';
import Dashboard from './components/Dashboard/Dashboard';
import Customers from './components/Customers/Customers';
import Billing from './components/Billing/Billing';
import Products from './components/Products/Products';
import Inventory from './components/Inventory/Inventory';
import Purchase from './components/Purchase/Purchase';
import Financial from './components/Financial/Financial';
import Reports from './components/Reports/Reports';
import SalesOrderHistory from './components/SalesOrderHistory/SalesOrderHistory';
import Refunds from './components/Refunds/Refunds';
import Staff from './components/Staff/Staff';
import StaffSignup from './components/Staff/StaffSignup';
import Upgrade from './components/Upgrade/Upgrade';
import Settings from './components/Settings/Settings';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isModuleUnlocked, getUpgradeMessage } from './utils/planUtils';
import { getPathForView, getViewFromPath } from './utils/navigation';
import { ActionTypes } from './context/AppContext';

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

const isPlanExpired = (state) => {
  if (!state) return false;
  if (state.isSubscriptionActive === false) return true;
  const subscriptionStatus = typeof state.subscription?.status === 'string'
    ? state.subscription.status.toLowerCase()
    : null;
  if (subscriptionStatus === 'expired') return true;
  const subscriptionExpiryDate = getSubscriptionExpiryDate(state);
  return subscriptionExpiryDate ? subscriptionExpiryDate.getTime() <= Date.now() : false;
};

const ProtectedLayout = () => {
  const location = useLocation();
  const { state, dispatch } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    const viewKey = getViewFromPath(location.pathname);
    if (viewKey && state.currentView !== viewKey) {
      // For staff users, don't override the view from URL until permissions are loaded
      // This prevents them from being stuck on dashboard when they don't have dashboard permission
      const isStaffUser = state.userType === 'staff' || state.currentUser?.userType === 'staff';
      const shouldOverride = !isStaffUser || state.permissionsInitiallyLoaded;

      if (shouldOverride) {
        dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: viewKey });
      }
    }
  }, [location.pathname, dispatch, state.currentView, state.userType, state.currentUser?.userType, state.permissionsInitiallyLoaded]);

  useEffect(() => {
    const navigateToView = (view, options = {}) => {
      if (!view) return;
      dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
      navigate(getPathForView(view), { replace: options.replace ?? false });
    };

    if (typeof window !== 'undefined') {
      window.navigateToView = navigateToView;
    }

    return () => {
      if (typeof window !== 'undefined' && window.navigateToView === navigateToView) {
        delete window.navigateToView;
      }
    };
  }, [dispatch, navigate]);

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
};

const ModuleGate = ({ viewKey, children }) => {
  const { state } = useApp();
  const isPlanInfoLoading = state.currentPlanDetails === null;

  if (isPlanInfoLoading) {
    return children;
  }

  const isStaffUser = state.userType === 'staff' || state.currentUser?.userType === 'staff';
  const planExpired = isPlanExpired(state);
  const isUpgradeRoute = viewKey === 'upgrade';
  const isStaffRoute = viewKey === 'staff';

  let isUnlocked = true;

  // Settings are always unlocked for everyone
  if (viewKey === 'settings') {
    isUnlocked = true;
  } else if (isStaffUser) {
    // For staff users, check permissions instead of plan unlocks
    if (isStaffRoute) {
      isUnlocked = false; // Staff cannot access staff management page
    } else {
      // Check if staff has the required permission
      const permissions = state.currentUser?.permissions || {};

      // Map view keys to permission keys (each requires its own permission)
      // Settings is removed from permission checks - staff always have access
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
        'reports': 'reports'
        // 'settings': removed - staff always have access without permission
      };

      const requiredPermission = permissionMap[viewKey];
      // If permissionMap[viewKey] is undefined (like for settings), staff always have access
      isUnlocked = requiredPermission ? Boolean(permissions[requiredPermission]) : true;

      // Only log permission issues, not successful checks
      if (!isUnlocked) {
        console.log(`🔒 STAFF ROUTE BLOCKED for ${viewKey}:`, {
          requiredPermission,
          permissionValue: permissions[requiredPermission],
          allStaffPermissions: Object.keys(permissions).filter(k => permissions[k] === true)
        });
      }
    }
  } else {
    // For seller users, use existing plan-based logic
    if (viewKey === 'upgrade' || viewKey === 'dashboard') {
      isUnlocked = true;
    } else {
      isUnlocked = isModuleUnlocked(viewKey, state.currentPlan, state.currentPlanDetails);
    }

    // Sellers should not access staff management unless they have permission
    if (isStaffRoute) {
      isUnlocked = true; // Allow sellers to access staff management
    }
  }

  // Plan expiry check only applies to sellers, not staff
  // Allow access to settings even for expired plans
  if (!isStaffUser && planExpired && !isUpgradeRoute && viewKey !== 'settings') {
    if (window?.showToast) {
      window.showToast('Your subscription has expired. Upgrade your plan to continue.', 'warning');
    }
    return <Navigate to={getPathForView('upgrade')} replace />;
  }

  if (!isUnlocked && !isUpgradeRoute) {
    if (window?.showToast) {
      const message = isStaffUser
        ? 'You do not have permission to access this feature.'
        : getUpgradeMessage(viewKey, state.currentPlan);
      window.showToast(message, 'warning');
    }

    // For staff users, redirect to their first permitted page instead of dashboard
    if (isStaffUser) {
      const permissions = state.currentUser?.permissions || {};
      const permissionPriority = [
        'customers', 'products', 'inventory', 'billing',
        'salesOrderHistory', 'refunds', 'purchaseOrders',
        'financial', 'reports', 'settings', 'dashboard'
      ];

      let redirectTo = 'dashboard'; // fallback
      for (const permission of permissionPriority) {
        if (permissions[permission] === true) {
          redirectTo = permission;
          break;
        }
      }

      return <Navigate to={getPathForView(redirectTo)} replace />;
    } else {
      return <Navigate to={getPathForView('dashboard')} replace />;
    }
  }

  return children;
};

const AppContent = () => {
  const { state } = useApp();

  if (!state.isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/staff/signup" element={<StaffSignup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <ModuleGate viewKey="dashboard">
              <Dashboard />
            </ModuleGate>
          }
        />
        <Route
          path="/customers"
          element={
            <ModuleGate viewKey="customers">
              <Customers />
            </ModuleGate>
          }
        />
        <Route
          path="/products"
          element={
            <ModuleGate viewKey="products">
              <Products />
            </ModuleGate>
          }
        />
        <Route
          path="/inventory"
          element={
            <ModuleGate viewKey="inventory">
              <Inventory />
            </ModuleGate>
          }
        />
        <Route
          path="/billing"
          element={
            <ModuleGate viewKey="billing">
              <Billing />
            </ModuleGate>
          }
        />
        <Route
          path="/purchase"
          element={
            <ModuleGate viewKey="purchase">
              <Purchase />
            </ModuleGate>
          }
        />
        <Route
          path="/financial"
          element={
            <ModuleGate viewKey="financial">
              <Financial />
            </ModuleGate>
          }
        />
        <Route
          path="/reports"
          element={
            <ModuleGate viewKey="reports">
              <Reports />
            </ModuleGate>
          }
        />
        <Route
          path="/sales-order-history"
          element={
            <ModuleGate viewKey="salesOrderHistory">
              <SalesOrderHistory />
            </ModuleGate>
          }
        />
        <Route
          path="/refunds"
          element={
            <ModuleGate viewKey="refunds">
              <Refunds />
            </ModuleGate>
          }
        />
        <Route
          path="/staff"
          element={
            <ModuleGate viewKey="staff">
              <Staff />
            </ModuleGate>
          }
        />
        <Route
          path="/upgrade"
          element={
            <ModuleGate viewKey="upgrade">
              <Upgrade />
            </ModuleGate>
          }
        />
        <Route
          path="/settings"
          element={
            <ModuleGate viewKey="settings">
              <Settings />
            </ModuleGate>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
};

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
