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
      dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: viewKey });
    }
  }, [location.pathname, dispatch, state.currentView]);

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
  if (viewKey === 'upgrade' || viewKey === 'dashboard') {
    isUnlocked = true;
  } else {
    isUnlocked = isModuleUnlocked(viewKey, state.currentPlan, state.currentPlanDetails);
  }

  if (planExpired && !isUpgradeRoute) {
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

  if (!state.isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
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
