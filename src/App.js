import React, { useEffect, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isModuleUnlocked, getUpgradeMessage } from './utils/planUtils';
import { isProfileComplete } from './utils/profileUtils';
import { getPathForView, getViewFromPath } from './utils/navigation';
import { ActionTypes } from './context/AppContext';
import { setupTabOrder } from './utils/focusManagement';
import { PageNavigationSkeleton } from './components/UI/SkeletonLoader';
import { usePWAUpdate } from './hooks/usePWAUpdate';
import { useOfflineReadiness } from './hooks/useOfflineReadiness';
import PromotionModal from './components/UI/PromotionModal';

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

// Define loaders for preloading capability
const componentLoaders = {
  Login: () => import('./components/Login/Login'),
  Layout: () => import('./components/Layout/Layout'),
  SellerRegistrationForm: () => import('./components/Onboarding/SellerRegistrationForm'),
  Dashboard: () => import('./components/Dashboard/Dashboard'),
  Customers: () => import('./components/Customers/Customers'),
  Suppliers: () => import('./components/Suppliers/Suppliers'),
  Billing: () => import('./components/Billing/Billing'),
  Products: () => import('./components/Products/Products'),
  DProducts: () => import('./components/DProducts/DProducts'),
  OnlineStore: () => import('./components/OnlineStore/OnlineStore'),
  Purchase: () => import('./components/Purchase/Purchase'),
  Financial: () => import('./components/Financial/Financial'),
  Reports: () => import('./components/Reports/Reports'),
  SalesOrderHistory: () => import('./components/SalesOrderHistory/SalesOrderHistory'),
  Refunds: () => import('./components/Refunds/Refunds'),
  Upgrade: () => import('./components/Upgrade/Upgrade'),
  PlanHistory: () => import('./components/PlanHistory/PlanHistory'),
  Settings: () => import('./components/Settings/Settings'),
  Gst: () => import('./components/Gst/GstPage'),
  Customization: () => import('./components/Customization/Customization'),
  ProductPerformance: () => import('./components/Reports/ProductPerformance'),
  ViewBill: () => import('./components/ViewBill/ViewBill'),
  Tutorials: () => import('./components/Tutorials/TutorialsPage'),
};

// Lazy load all route components for code splitting using the loaders
const Login = lazy(componentLoaders.Login);
const Layout = lazy(componentLoaders.Layout);
const SellerRegistrationForm = lazy(componentLoaders.SellerRegistrationForm);
const Dashboard = lazy(componentLoaders.Dashboard);
const Customers = lazy(componentLoaders.Customers);
const Suppliers = lazy(componentLoaders.Suppliers);
const Billing = lazy(componentLoaders.Billing);
const Products = lazy(componentLoaders.Products);
const DProducts = lazy(componentLoaders.DProducts);
const OnlineStore = lazy(componentLoaders.OnlineStore);
const Purchase = lazy(componentLoaders.Purchase);
const Financial = lazy(componentLoaders.Financial);
const Reports = lazy(componentLoaders.Reports);
const SalesOrderHistory = lazy(componentLoaders.SalesOrderHistory);
const Refunds = lazy(componentLoaders.Refunds);
const Upgrade = lazy(componentLoaders.Upgrade);
const PlanHistory = lazy(componentLoaders.PlanHistory);
const Settings = lazy(componentLoaders.Settings);
const Gst = lazy(componentLoaders.Gst);
const Customization = lazy(componentLoaders.Customization);
const ProductPerformance = lazy(componentLoaders.ProductPerformance);
const ViewBill = lazy(componentLoaders.ViewBill);
const Tutorials = lazy(componentLoaders.Tutorials);




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

  // Check for profile completion and redirect if necessary
  useEffect(() => {
    if (state.isAuthenticated && state.currentUser && !isProfileComplete(state.currentUser)) {
      // Redirect to complete profile page if profile is not complete
      console.log('Redirecting to complete profile...');
      navigate('/complete-profile', { replace: true });
    }
  }, [state.isAuthenticated, state.currentUser, navigate]);

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

  // Exempt 'upgrade' route from checks to avoid infinite loops
  const isUpgradeRoute = viewKey === 'upgrade';

  // Actually check if module is unlocked
  const isUnlocked = isUpgradeRoute ? true : isModuleUnlocked(viewKey, state.currentPlan, state.currentPlanDetails);

  if (!isUnlocked) {
    if (window.showToast) {
      // Show toast only once to avoid spamming on renders (optional, but good practice)
      // For simplicity, we just trigger it. Debouncing might be handled by showToast itself.
      setTimeout(() => window.showToast('Access Denied: Please upgrade your plan to access this feature', 'error'), 100);
    }
    return <Navigate to="/upgrade" replace />;
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
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const { updateAvailable, update, dismiss } = usePWAUpdate();
  const {
    isOfflineReady,
    isChecking,
    missingResources,
    cacheProgress,
    downloadForOffline
  } = useOfflineReadiness();

  const [showOfflineModal, setShowOfflineModal] = React.useState(false);
  const [offlineModalDismissed, setOfflineModalDismissed] = React.useState(false);
  const [showPromotion, setShowPromotion] = React.useState(false);
  const [activeCoupon, setActiveCoupon] = React.useState(null);
  const promotionCheckDone = React.useRef(false);

  // Show promotion on application open
  useEffect(() => {
    // Only show if user is authenticated and profile is complete
    if (!state.isAuthenticated || !state.currentUser?.profileCompleted) return;

    // Prevent multiple checks
    if (promotionCheckDone.current) return;
    promotionCheckDone.current = true;

    const initializePromotion = async () => {
      // 1. Ensure we have coupons. If not in state, fetch them explicitly NOW.
      let couponsToCheck = state.coupons || [];

      if (couponsToCheck.length === 0) {
        try {
          const { fetchCoupons } = await import('./utils/dataFetcher');
          // console.log('🎁 Fetching coupons for promotion...');
          const fetched = await fetchCoupons();
          if (fetched && Array.isArray(fetched) && fetched.length > 0) {
            couponsToCheck = fetched;
            // Update global state so we don't fetch again unnecessarily
            dispatch({ type: ActionTypes.SET_COUPONS, payload: fetched });
          }
        } catch (error) {
          console.error('Failed to fetch coupons for promotion:', error);
        }
      }

      // 2. Logic to pick a coupon
      let selectedCoupon = null;
      if (couponsToCheck.length > 0) {
        const dismissedCoupons = JSON.parse(localStorage.getItem('dismissedCoupons') || '[]');
        const availableCoupons = couponsToCheck.filter(c => !dismissedCoupons.includes(c._id));

        if (availableCoupons.length > 0) {
          selectedCoupon = availableCoupons[Math.floor(Math.random() * availableCoupons.length)];
        }
      }

      setActiveCoupon(selectedCoupon);

      // 3. Show once per session (reset on tab close, persists on refresh)
      const isSessionShown = sessionStorage.getItem('promotionSessionShown');

      if (!isSessionShown && selectedCoupon) {
        setTimeout(() => {
          setShowPromotion(true);
          sessionStorage.setItem('promotionSessionShown', 'true');
        }, 1500); // 1.5s delay for smooth entry
      }
    };

    initializePromotion();
  }, [state.isAuthenticated, state.currentUser?.profileCompleted, dispatch]);

  const preloadDone = React.useRef(false);

  // Preload all components for offline support
  useEffect(() => {
    if (state.isAuthenticated && !preloadDone.current) {
      preloadDone.current = true;

      const preloadAll = async () => {
        // console.log('Preloading all components for offline support...');
        const loaders = Object.values(componentLoaders);

        for (const loader of loaders) {
          try {
            // Load and catch potential errors silently
            loader().catch(() => { });
            // Small delay to keep UI responsive
            await new Promise(r => setTimeout(r, 50));
          } catch (e) {
            // ignore
          }
        }
      };

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => preloadAll(), { timeout: 2000 });
      } else {
        setTimeout(preloadAll, 3000); // 3s delay after load
      }
    }
  }, [state.isAuthenticated]);

  const handleClosePromotion = () => {
    setShowPromotion(false);
    localStorage.setItem('promotionLastShown', Date.now().toString());

    // Mark this specific coupon as dismissed
    if (activeCoupon?._id) {
      const dismissedCoupons = JSON.parse(localStorage.getItem('dismissedCoupons') || '[]');
      if (!dismissedCoupons.includes(activeCoupon._id)) {
        dismissedCoupons.push(activeCoupon._id);
        localStorage.setItem('dismissedCoupons', JSON.stringify(dismissedCoupons));
      }
    }
  };

  const handleClaimPromotion = () => {
    setShowPromotion(false);
    localStorage.setItem('promotionLastShown', Date.now().toString());
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: 'upgrade' });
    navigate('/upgrade');
  };

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

  // Request notification permission for background sync notifications
  useEffect(() => {
    if (state.isAuthenticated && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          console.log('Notification permission granted.');
        }
      });
    }
  }, [state.isAuthenticated]);

  // Check offline readiness after authentication
  // DISABLED: Auto-download popup removed per user request
  /*
  useEffect(() => {
    if (state.isAuthenticated && !isChecking && !isOfflineReady && !offlineModalDismissed) {
      // Check if user dismissed this before (stored in localStorage)
      const dismissed = localStorage.getItem('offlineDownloadDismissed');
      const dismissedTime = dismissed ? parseInt(dismissed) : 0;
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
 
      // Show modal if not dismissed or if dismissed more than 24 hours ago
      if (!dismissed || dismissedTime < oneDayAgo) {
        // Delay showing modal by 2 seconds to avoid overwhelming user on login
        const timer = setTimeout(() => {
          setShowOfflineModal(true);
        }, 2000);
 
        return () => clearTimeout(timer);
      }
    }
  }, [state.isAuthenticated, isChecking, isOfflineReady, offlineModalDismissed]);
  */

  const handleDownloadOffline = async () => {
    await downloadForOffline();
    setShowOfflineModal(false);
  };

  const handleDismissOfflineModal = () => {
    setShowOfflineModal(false);
    setOfflineModalDismissed(true);
    // Remember dismissal for 24 hours
    localStorage.setItem('offlineDownloadDismissed', Date.now().toString());
  };

  if (!state.isAuthenticated) {
    return (
      <>
        <Suspense fallback={<PageNavigationSkeleton />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/view-bill/:invoiceNo" element={<ViewBill />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </>
    );
  }

  return (
    <>
      <PromotionModal
        isOpen={showPromotion}
        onClose={handleClosePromotion}
        onClaim={handleClaimPromotion}
        coupon={activeCoupon}
      />
      {/* DISABLED: Offline download modal removed per user request
      <OfflineDownloadModal
        isOpen={showOfflineModal}
        onClose={handleDismissOfflineModal}
        onDownload={handleDownloadOffline}
        isDownloading={isChecking}
        cacheProgress={cacheProgress}
        missingResources={missingResources}
      />
      */}
      <MobileLayoutDetector />
      <Routes>
        <Route path="/view-bill/:invoiceNo" element={<ViewBill />} />
        <Route path="/complete-profile" element={<SellerRegistrationForm />} />
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
            path="/suppliers"
            element={
              <ModuleGate viewKey="suppliers">
                <Suppliers />
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
            path="/d-products"
            element={
              <ModuleGate viewKey="dProducts">
                <DProducts />
              </ModuleGate>
            }
          />
          <Route
            path="/online-store"
            element={
              <ModuleGate viewKey="onlineStore">
                <OnlineStore />
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
            path="/plan-history"
            element={
              <ModuleGate viewKey="planHistory">
                <PlanHistory />
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
          <Route
            path="/gst"
            element={
              <ModuleGate viewKey="gst">
                <Gst />
              </ModuleGate>
            }
          />
          <Route
            path="/customization"
            element={
              <ModuleGate viewKey="customization">
                <Customization />
              </ModuleGate>
            }
          />
          <Route
            path="/product-performance"
            element={
              <ModuleGate viewKey="productPerformance">
                <ProductPerformance />
              </ModuleGate>
            }
          />
          <Route
            path="/tutorials"
            element={
              <ModuleGate viewKey="tutorials">
                <Tutorials />
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
