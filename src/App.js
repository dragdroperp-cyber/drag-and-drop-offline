import React, { useEffect, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isModuleUnlocked, getUpgradeMessage } from './utils/planUtils';
import { getPathForView, getViewFromPath } from './utils/navigation';
import { ActionTypes } from './context/AppContext';
import { setupTabOrder } from './utils/focusManagement';

// Lazy load all route components for code splitting
const Login = lazy(() => import('./components/Login/Login'));
const Layout = lazy(() => import('./components/Layout/Layout'));
const SellerRegistrationForm = lazy(() => import('./components/Onboarding/SellerRegistrationForm'));
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard'));
const Customers = lazy(() => import('./components/Customers/Customers'));
const Billing = lazy(() => import('./components/Billing/Billing'));
const Products = lazy(() => import('./components/Products/Products'));
const Inventory = lazy(() => import('./components/Inventory/Inventory'));
const Purchase = lazy(() => import('./components/Purchase/Purchase'));
const Financial = lazy(() => import('./components/Financial/Financial'));
const Reports = lazy(() => import('./components/Reports/Reports'));
const SalesOrderHistory = lazy(() => import('./components/SalesOrderHistory/SalesOrderHistory'));
const Refunds = lazy(() => import('./components/Refunds/Refunds'));
const Upgrade = lazy(() => import('./components/Upgrade/Upgrade'));
const Settings = lazy(() => import('./components/Settings/Settings'));

// Loading component for Suspense fallback
const LoadingSpinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

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
      // Override the current view based on URL
      const shouldOverride = true;

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

  const planExpired = isPlanExpired(state);
  const isUpgradeRoute = viewKey === 'upgrade';

  let isUnlocked = true;

  // Settings are always unlocked
  if (viewKey === 'settings') {
    isUnlocked = true;
  } else {
    // Use plan-based logic
    if (viewKey === 'upgrade' || viewKey === 'dashboard') {
      isUnlocked = true;
    } else {
      isUnlocked = isModuleUnlocked(viewKey, state.currentPlan, state.currentPlanDetails);
    }
  }

  // Plan expiry check - allow access to settings even for expired plans
  if (planExpired && !isUpgradeRoute && viewKey !== 'settings') {
    if (window?.showToast) {
      window.showToast('Your subscription has expired. Upgrade your plan to continue.', 'warning');
    }
    return <Navigate to={getPathForView('upgrade')} replace />;
  }

  if (!isUnlocked && !isUpgradeRoute) {
    if (window?.showToast) {
      window.showToast(getUpgradeMessage(viewKey, state.currentPlan), 'warning');
    }
      return <Navigate to={getPathForView('dashboard')} replace />;
  }

  return children;
};

const AppContent = () => {
  const { state } = useApp();

  // Set up proper tab order for accessibility
  useEffect(() => {
    setupTabOrder();
  }, []);

  if (!state.isAuthenticated) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingSpinner />}>
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
    </Suspense>
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
