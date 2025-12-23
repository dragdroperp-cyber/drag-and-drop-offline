import React, { useEffect, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isModuleUnlocked, getUpgradeMessage } from './utils/planUtils';
import { getPathForView, getViewFromPath } from './utils/navigation';
import { ActionTypes } from './context/AppContext';
import { setupTabOrder } from './utils/focusManagement';
import { PageNavigationSkeleton } from './components/UI/SkeletonLoader';
import { usePWAUpdate } from './hooks/usePWAUpdate';
import UpdateNotification from './components/UI/UpdateNotification';

// Mobile device detection utility
const isMobileDevice = () => {
  // Check for touch capability
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Check for mobile user agents
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone'];
  const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));

  // Check screen size (but don't rely solely on this)
  const isSmallScreen = window.innerWidth < 768;

  // Force mobile layout for touch devices, mobile UAs, or when in PWA standalone mode
  return hasTouch || isMobileUA || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || isSmallScreen;
};

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
      <Suspense fallback={<PageNavigationSkeleton />}>
        <Outlet />
      </Suspense>
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

  // For expired plans, block dashboard but allow other pages (read-only mode)
  if (planExpired) {
    if (viewKey === 'dashboard') {
      // Block dashboard for expired plans, redirect to upgrade
      if (window?.showToast) {
        window.showToast('Your plan has expired. Please upgrade to access the dashboard.', 'warning');
      }
      return <Navigate to={getPathForView('upgrade')} replace />;
    }
    // Allow access to upgrade page and other pages (view data in read-only mode)
    isUnlocked = true;
  } else {
    // For active plans, use plan-based restrictions
    // Settings are always unlocked
    if (viewKey === 'settings') {
      isUnlocked = true;
    } else {
      // Use plan-based logic
      if (viewKey === 'upgrade' || viewKey === 'dashboard') {
        isUnlocked = true;
      } else {
        // If plan details are still loading, allow access temporarily
        if (isPlanInfoLoading) {
          isUnlocked = true;
        } else {
          isUnlocked = isModuleUnlocked(viewKey, state.currentPlan, state.currentPlanDetails);
        }
      }
    }

    // For active plans, redirect to dashboard if module is locked (but not while loading)
    if (!isUnlocked && !isUpgradeRoute && !isPlanInfoLoading) {
      if (window?.showToast) {
        window.showToast(getUpgradeMessage(viewKey, state.currentPlan), 'warning');
      }
      return <Navigate to={getPathForView('dashboard')} replace />;
    }
  }

  return children;
};

// Component to handle mobile layout detection
const MobileLayoutDetector = () => {
  useEffect(() => {
    // Detect mobile device and force mobile layout if needed
    const isMobile = isMobileDevice();

    if (isMobile) {
      document.body.classList.add('force-mobile-layout');
    } else {
      document.body.classList.remove('force-mobile-layout');
    }

    // Also check on resize in case device orientation changes
    const handleResize = () => {
      const currentIsMobile = isMobileDevice();
      if (currentIsMobile && !document.body.classList.contains('force-mobile-layout')) {
        document.body.classList.add('force-mobile-layout');
      } else if (!currentIsMobile && document.body.classList.contains('force-mobile-layout')) {
        document.body.classList.remove('force-mobile-layout');
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return null; // This component doesn't render anything
};

const AppContent = () => {
  const { state } = useApp();
  const { updateAvailable, update, dismiss } = usePWAUpdate();

  // Set up proper tab order for accessibility
  useEffect(() => {
    setupTabOrder();
  }, []);

  // Apply dark mode class to html element
  useEffect(() => {
    if (state.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [state.darkMode]);

  if (!state.isAuthenticated) {
    return (
      <>
        {updateAvailable && (
          <UpdateNotification onUpdate={update} onDismiss={dismiss} />
        )}
        <Suspense fallback={<PageNavigationSkeleton />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </>
    );
  }

  return (
    <>
      {updateAvailable && (
        <UpdateNotification onUpdate={update} onDismiss={dismiss} />
      )}
      <MobileLayoutDetector />
      <MobileLayoutDetector />
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
    </>
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
