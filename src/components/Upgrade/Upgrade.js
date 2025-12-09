import React, { useState, useEffect } from 'react';
import { useApp, ActionTypes, mergePlanDetailsWithUsage } from '../../context/AppContext';
import { Crown, Check, Star, Zap, Shield, Users, Lock, Unlock, Loader, Package } from 'lucide-react';
import { apiRequest } from '../../utils/api';

const Upgrade = () => {
  const { state, dispatch } = useApp();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sellerPlanInfo, setSellerPlanInfo] = useState(null);
  const [activePlanOrdersCount, setActivePlanOrdersCount] = useState(0);
  const [upgradingPlanId, setUpgradingPlanId] = useState(null);
  const [selectedPlanType, setSelectedPlanType] = useState('');
  const [aggregatedUsage, setAggregatedUsage] = useState(null);
  const [hasValidPlans, setHasValidPlans] = useState(false);
  const [hasUsedFreePlan, setHasUsedFreePlan] = useState(false);

  // Use aggregated usage from all valid plan orders instead of just current plan
  const usageCards = aggregatedUsage
    ? [
        { key: 'customers', label: 'Customers', summary: aggregatedUsage.customers },
        { key: 'products', label: 'Products', summary: aggregatedUsage.products },
        { key: 'orders', label: 'Orders', summary: aggregatedUsage.orders }
      ].filter(card => card.summary)
    : [];

  // Debug: Log aggregated usage changes
  React.useEffect(() => {
    if (aggregatedUsage) {

    }
  }, [aggregatedUsage]);

  // Check if user's current plan is valid
  React.useEffect(() => {
    const checkCurrentPlanValid = () => {
      const planOrders = state.planOrders || [];
      const currentPlanId = state.currentPlan?._id || state.currentPlan?.id || state.currentPlan;
      const now = new Date();

      // Find the current plan order
      const currentPlanOrder = planOrders.find(order =>
        order._id === currentPlanId ||
        order.id === currentPlanId ||
        order.planOrderId === currentPlanId
      );

      let hasValidCurrentPlan = false;

      if (currentPlanOrder) {
        // Check if current plan is not expired and has future expiry date
        hasValidCurrentPlan = currentPlanOrder.status !== 'expired' &&
                              currentPlanOrder.expiryDate &&
                              new Date(currentPlanOrder.expiryDate) > now;
      }

      // Check if user has ever used a free plan (price = 0 and not mini plan)
      const hasEverUsedFreePlan = planOrders.some(order =>
        order.price === 0 &&
        (!order.planId || (typeof order.planId === 'object' && order.planId?.planType !== 'mini') ||
         (typeof order.planId === 'string' && !order.planId.includes('mini')))
      );

      setHasValidPlans(hasValidCurrentPlan);
      setHasUsedFreePlan(hasEverUsedFreePlan);

    };

    checkCurrentPlanValid();
  }, [state.planOrders, state.currentPlan]);

  // Auto-adjust selected plan type if free plans become unavailable
  React.useEffect(() => {
    if (selectedPlanType === 'free' && hasUsedFreePlan) {
      // If free was selected but now unavailable, clear the selection
      setSelectedPlanType('');
    }
  }, [hasUsedFreePlan, selectedPlanType]);

  // Helper functions
  const formatUsedValue = React.useCallback((info) => (typeof info?.used === 'number' ? info.used : 0), []);
  const formatLimitValue = React.useCallback((info) => (info?.isUnlimited ? 'Unlimited' : (typeof info?.limit === 'number' ? info.limit : 0)), []);
  const formatRemainingValue = React.useCallback((info) => {
    if (!info) return 0;
    if (info.isUnlimited) return 'Unlimited';
    if (typeof info.remaining === 'number') {
      return Math.max(0, info.remaining);
    }
    if (typeof info.limit === 'number') {
      return Math.max(0, info.limit - formatUsedValue(info));
    }
    return Math.max(0, -formatUsedValue(info));
  }, [formatUsedValue]);

  // Extract fetchPlans as a separate function so we can call it after upgrade
  const fetchPlans = async () => {
    try {
      setError(null);
      // Add cache-busting parameter to ensure fresh data after plan upgrade
      const result = await apiRequest(`/data/plans?_t=${Date.now()}`);

      // Handle plan validation errors gracefully on upgrade page
      if (result.planInvalid) {

        setError('Your plan has expired. Please select a plan below to continue.');
        return;
      }

      if (result.success && result.data) {
        // Handle the response structure: backend returns { success: true, data: [...] }
        // apiRequest wraps it: { success: true, data: { success: true, data: [...] } }
        // So we need to check result.data.data or result.data (if it's already an array)
        const responseData = Array.isArray(result.data) ? result.data : result.data;

        let plansData = [];
        let planInfo = null;
        let planCount = 0;

        if (Array.isArray(responseData)) {
          plansData = responseData;
        } else if (responseData && Array.isArray(responseData.data)) {
          plansData = responseData.data;
          planInfo = responseData.sellerPlanInfo;
          planCount = responseData.activePlanOrdersCount || 0;
        } else if (result.data.data && Array.isArray(result.data.data)) {
          plansData = result.data.data;
          planInfo = result.data.sellerPlanInfo;
          planCount = result.data.activePlanOrdersCount || 0;
        }

        if (Array.isArray(plansData)) {
          // Map database plans to component format
          // Use isCurrentPlan from backend if available
          const formattedPlans = plansData.map(plan => ({
            ...plan,
            // Ensure planType is preserved from backend
            planType: plan.planType || 'standard',
            // Use backend's isCurrentPlan flag, or fallback to local check
            current: plan.isCurrentPlan !== undefined 
              ? plan.isCurrentPlan
              : (state.currentPlan === plan.id || 
                 state.currentPlan === plan._id ||
                 state.currentPlan === plan.name?.toLowerCase()?.replace(/\s+/g, '-'))
          }));

          // Debug: Log plan current status

          console.log('🔄 PLAN UPDATE: Plans with current status:', formattedPlans.map(p => ({
            id: p.id,
            _id: p._id,
            name: p.name,
            isCurrentPlan: p.isCurrentPlan,
            localCheck: (state.currentPlan === p.id || state.currentPlan === p._id),
            current: p.current
          })));

          setPlans(formattedPlans);

          // Set seller plan info if available
          if (planInfo) {
            setSellerPlanInfo(planInfo);
          } else if (result.data?.sellerPlanInfo) {
            setSellerPlanInfo(result.data.sellerPlanInfo);
          }

          if (planCount > 0) {
            setActivePlanOrdersCount(planCount);
          } else if (result.data?.activePlanOrdersCount) {
            setActivePlanOrdersCount(result.data.activePlanOrdersCount);
          }
        } else {
          setError('Invalid plans data format');
          setPlans([]);
        }
      } else {
        setError('No internet');
        if (window.showToast) window.showToast('No internet', 'error');
        // Fallback to empty array or default plans
        setPlans([]);
      }
    } catch (err) {

      setError('No internet');
      if (window.showToast) window.showToast('No internet', 'error');
      setPlans([]);
    }
  };

  // Fetch plans from database
  useEffect(() => {
    const loadPlans = async () => {
      setLoading(true);
      await fetchPlans();
      await refreshPlanDetails(); // Load aggregated usage from all plan orders
      setLoading(false);
    };

    loadPlans();
  }, [state.currentPlan]);

  const getPlanColor = (color) => {
    const colors = {
      green: 'bg-green-500',
      blue: 'bg-blue-500',
      purple: 'bg-purple-500'
    };
    return colors[color] || 'bg-gray-500';
  };

  const getPlanBorderColor = (color) => {
    const colors = {
      green: 'border-green-200',
      blue: 'border-blue-200',
      purple: 'border-purple-200'
    };
    return colors[color] || 'border-gray-200';
  };

  // Helper functions to get styling based on planType - clean and branded
  const getPlanTypeStyles = (planType) => {
    const styles = {
      free: {
        cardBg: 'bg-white',
        border: 'border-2',
        borderColor: 'border-green-400',
        ringColor: 'ring-green-500',
        headerBg: 'bg-green-500',
        headerText: 'text-white',
        badgeBg: 'bg-green-500',
        accentColor: 'text-green-600',
        accentBg: 'bg-green-50',
        buttonBg: 'bg-green-500 hover:bg-green-600',
        iconBg: 'bg-white/20',
        sectionBg: 'bg-green-50',
        sectionBorder: 'border-green-300',
        sectionTitle: 'Free Plans',
        sectionDescription: 'Get started with our free plan - no credit card required',
        sectionIcon: '🟢'
      },
      mini: {
        cardBg: 'bg-white',
        border: 'border',
        borderColor: 'border-gray-200',
        ringColor: 'ring-[#2F3C7E]',
        headerBg: 'bg-[#2F3C7E]',
        headerText: 'text-white',
        badgeBg: 'bg-[#2F3C7E]',
        accentColor: 'text-[#2F3C7E]',
        accentBg: 'bg-gray-50',
        buttonBg: 'bg-[#2F3C7E] hover:bg-[#3d4a8f]',
        iconBg: 'bg-white/20',
        sectionBg: 'bg-gray-50',
        sectionBorder: 'border-gray-300',
        sectionTitle: 'Mini Plans',
        sectionDescription: 'Perfect for small businesses getting started',
        sectionIcon: '🟦'
      },
      standard: {
        cardBg: 'bg-white',
        border: 'border-2',
        borderColor: 'border-[#2F3C7E]',
        ringColor: 'ring-[#2F3C7E]',
        headerBg: 'bg-[#2F3C7E]',
        headerText: 'text-white',
        badgeBg: 'bg-[#2F3C7E]',
        accentColor: 'text-[#2F3C7E]',
        accentBg: 'bg-[#2F3C7E]/5',
        buttonBg: 'bg-[#2F3C7E] hover:bg-[#3d4a8f]',
        iconBg: 'bg-white/20',
        sectionBg: 'bg-[#2F3C7E]/5',
        sectionBorder: 'border-[#2F3C7E]',
        sectionTitle: 'Standard Plans',
        sectionDescription: 'Ideal for growing businesses with moderate needs',
        sectionIcon: '⚫'
      },
      pro: {
        cardBg: 'bg-white',
        border: 'border',
        borderColor: 'border-gray-200',
        ringColor: 'ring-[#2F3C7E]',
        headerBg: 'bg-[#2F3C7E]',
        headerText: 'text-white',
        badgeBg: 'bg-[#2F3C7E]',
        accentColor: 'text-[#2F3C7E]',
        accentBg: 'bg-gray-50',
        buttonBg: 'bg-[#2F3C7E] hover:bg-[#3d4a8f]',
        iconBg: 'bg-white/20',
        sectionBg: 'bg-gray-50',
        sectionBorder: 'border-gray-300',
        sectionTitle: 'Pro Plans',
        sectionDescription: 'Advanced features for established businesses',
        sectionIcon: '🟧'
      }
    };
    return styles[planType] || styles.standard;
  };

  // Group plans by planType - separate free plans from paid plans
  const groupPlansByType = (plans, excludeFreePlans = false) => {
    const grouped = {
      free: [],
      mini: [],
      standard: [],
      pro: []
    };

    plans.forEach(plan => {
      // Check if plan is free
      const planPrice = plan?.rawPrice || parseFloat(plan?.price?.replace('₹', '') || '0');
      const isFree = planPrice === 0;

      if (isFree && !excludeFreePlans) {
        // Add free plans to separate group only if not excluded
        grouped.free.push(plan);
      } else if (!isFree) {
        // Normalize planType to lowercase and handle variations
        const planType = (plan.planType || 'standard').toLowerCase().trim();

        // Map to valid types
        if (planType === 'mini') {
          grouped.mini.push(plan);
        } else if (planType === 'pro') {
          grouped.pro.push(plan);
        } else {
          // Default to standard for 'standard' or any other value
          grouped.standard.push(plan);
        }
      }
    });

    // Debug: Log grouping results

    return grouped;
  };

  // Helper function to refresh plan details
  const refreshPlanDetails = async () => {
    try {
      const [planResult, usageResult] = await Promise.all([
        apiRequest(`/data/current-plan?_t=${Date.now()}`),
        apiRequest('/plans/usage')
      ]);

      // Handle plan validation errors gracefully on upgrade page
      if (planResult.planInvalid || usageResult.planInvalid) {

        return;
      }

      const planPayload = planResult.success && planResult.data
        ? (Array.isArray(planResult.data) ? planResult.data : planResult.data.data || planResult.data)
        : null;

      const usagePayload = usageResult.success && usageResult.data && usageResult.data.summary
        ? usageResult.data
        : null;

      // Store aggregated usage from all valid plan orders
      if (usagePayload && usagePayload.summary) {

        setAggregatedUsage(usagePayload.summary);
      }

      let combinedPlanDetails = mergePlanDetailsWithUsage(planPayload, usagePayload);
      if (!combinedPlanDetails && planPayload) {
        combinedPlanDetails = { ...planPayload };
      }

      if (combinedPlanDetails) {

        dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combinedPlanDetails });
        if (combinedPlanDetails.planId) {

          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combinedPlanDetails.planId });
        }
      }
    } catch (planError) {

    }
  };

  const handlePlanSelect = async (planId) => {
    const selectedPlan = plans.find(p => p.id === planId || p._id === planId);
    const isMiniPlan = selectedPlan?.planType === 'mini';

    // If this is already the current plan, do nothing
    if (selectedPlan?.current) {
      return;
    }

    // For mini plans, skip the switch logic - they are top-ups, not switches
    // If user already has this plan (valid, non-expired), just switch to it (only for non-mini plans)
    if (selectedPlan?.userHasThisPlan && !isMiniPlan) {
      try {
        setUpgradingPlanId(planId);
        const result = await apiRequest('/data/plans/upgrade', {
          method: 'POST',
          body: { planId }
        });

        if (result.success) {
          const resultData = result.data?.data || result.data;
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
          window.showToast(`Switched to ${resultData?.planName || selectedPlan?.name || 'selected plan'}!`, 'success');

          // Trigger delta sync to update planOrders in IndexedDB

          try {
            const deltaSyncResult = await apiRequest('/data/delta-sync', {
              method: 'POST',
              body: {
                lastFetchTimes: {
                  customers: Date.now(),
                  products: Date.now(),
                  orders: Date.now(),
                  transactions: Date.now(),
                  purchaseOrders: Date.now(),
                  categories: Date.now(),
                  refunds: Date.now(),
                  plans: Date.now(),
                  planOrders: Date.now(), // Force sync planOrders
                  staff: Date.now()
                }
              }
            });

            if (deltaSyncResult.success) {

              // Update UI with synced data
              const { fetchAllDataWithDeltaSync } = await import('../utils/dataFetcher');
              const indexedDBData = await fetchAllDataWithDeltaSync();
              if (indexedDBData) {
                // Update UI state with fresh IndexedDB data
                dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: indexedDBData.planOrders || [] });

              }
            } else {

            }
          } catch (syncError) {

          }

          await fetchPlans();
          await refreshPlanDetails();
        } else {
          const message = result.message || result.error || 'Unable to switch plan right now.';
          window.showToast(message, 'error');
        }
      } catch (err) {

        window.showToast('No internet', 'error');
      } finally {
        setUpgradingPlanId(null);
      }
      return;
    }

    // For new plans, check if it's free or paid
    const planPrice = selectedPlan?.rawPrice || parseFloat(selectedPlan?.price?.replace('₹', '') || '0');

    // Mini plans always require payment, even if price is 0
    // If plan is free AND not a mini plan, upgrade directly
    if (planPrice === 0 && !isMiniPlan) {
      try {
        setUpgradingPlanId(planId);
        const result = await apiRequest('/data/plans/upgrade', {
          method: 'POST',
          body: { planId }
        });

        if (result.success) {
          const resultData = result.data?.data || result.data;
          // For mini plans, don't update currentPlan (they are top-ups, not main plans)
          if (!isMiniPlan) {
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
          }
          const message = isMiniPlan 
            ? `Successfully topped up with ${resultData?.planName || selectedPlan?.name || 'selected plan'}!`
            : `Successfully upgraded to ${resultData?.planName || selectedPlan?.name || 'selected plan'}!`;
          window.showToast(message, 'success');
          await fetchPlans();
          await refreshPlanDetails();
        } else {
          const message = result.message || result.error || 'Unable to activate this plan.';
          window.showToast(message, 'error');
        }
      } catch (err) {

        window.showToast('No internet', 'error');
      } finally {
        setUpgradingPlanId(null);
      }
      return;
    }

    // For paid plans, create Razorpay order and open checkout
    try {
      setUpgradingPlanId(planId);

      // Create Razorpay order
      const orderResult = await apiRequest('/data/plans/create-razorpay-order', {
        method: 'POST',
        body: { planId }
      });

      if (!orderResult.success) {
        window.showToast('No internet', 'error');
        setUpgradingPlanId(null);
        return;
      }

      // Extract data from response (apiRequest wraps the backend response)
      const responseData = orderResult.data?.data || orderResult.data;

      // Check if plan is free (shouldn't happen here, but just in case)
      if (responseData?.isFree) {
        const upgradeResult = await apiRequest('/data/plans/upgrade', {
          method: 'POST',
          body: { planId }
        });
        if (upgradeResult.success) {
          const upgradeData = upgradeResult.data?.data || upgradeResult.data;
          // For mini plans, don't update currentPlan (they are top-ups, not main plans)
          if (!isMiniPlan) {

            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
          }
          const message = isMiniPlan 
            ? `Successfully topped up with ${upgradeData?.planName || selectedPlan?.name || 'selected plan'}!`
            : `Successfully upgraded to ${upgradeData?.planName || selectedPlan?.name || 'selected plan'}!`;
          window.showToast(message, 'success');

          // Add a delay to allow backend to process the upgrade
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Refresh plan details first to get the latest current plan info and aggregated usage

          await refreshPlanDetails();

          // Then fetch plans to get updated isCurrentPlan flags

          await fetchPlans();

          // Trigger delta sync to update planOrders in IndexedDB

          try {
            const deltaSyncResult = await apiRequest('/data/delta-sync', {
              method: 'POST',
              body: {
                lastFetchTimes: {
                  customers: Date.now(),
                  products: Date.now(),
                  orders: Date.now(),
                  transactions: Date.now(),
                  purchaseOrders: Date.now(),
                  categories: Date.now(),
                  refunds: Date.now(),
                  plans: Date.now(),
                  planOrders: Date.now(), // Force sync planOrders
                  staff: Date.now()
                }
              }
            });

            if (deltaSyncResult.success) {

              // Update UI with synced data
              const { fetchAllDataWithDeltaSync } = await import('../utils/dataFetcher');
              const indexedDBData = await fetchAllDataWithDeltaSync();
              if (indexedDBData) {
                // Update UI state with fresh IndexedDB data
                dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: indexedDBData.planOrders || [] });

              }
            } else {

            }
          } catch (syncError) {

          }

          // Force another refresh of aggregated usage to ensure it's updated

          await new Promise(resolve => setTimeout(resolve, 1000)); // Extra delay
          await refreshPlanDetails();
        }
        setUpgradingPlanId(null);
        return;
      }

      const { orderId, amount, currency, key } = responseData;

      // Validate that key exists
      if (!key) {

        window.showToast('Payment configuration error. Please contact support.', 'error');
        setUpgradingPlanId(null);
        return;
      }

      // Validate that Razorpay script is loaded
      if (!window.Razorpay) {

        window.showToast('Payment gateway is not available. Please refresh the page.', 'error');
        setUpgradingPlanId(null);
        return;
      }

      // Validate required payment details
      if (!orderId || !amount || !currency) {

        window.showToast('Invalid payment order. Please try again.', 'error');
        setUpgradingPlanId(null);
        return;
      }

      // Initialize Razorpay checkout
      const options = {
        key: key,
        amount: amount,
        currency: currency,
        name: 'Drag & Drop',
        description: `Plan Purchase: ${selectedPlan?.name || 'Selected Plan'}`,
        order_id: orderId,
        handler: async function (response) {
          try {
            // Verify payment on backend
            const verifyResult = await apiRequest('/data/plans/verify-razorpay-payment', {
              method: 'POST',
              body: {
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
                planId
              }
            });

            if (verifyResult.success) {
              const verifyData = verifyResult.data?.data || verifyResult.data;
              // For mini plans, don't update currentPlan (they are top-ups, not main plans)
              if (!isMiniPlan) {
                dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
              }
              const message = isMiniPlan 
                ? `Successfully topped up with ${verifyData?.planName || selectedPlan?.name || 'selected plan'}!`
                : `Successfully upgraded to ${verifyData?.planName || selectedPlan?.name || 'selected plan'}!`;
              window.showToast(message, 'success');

              // Add a delay to allow backend to process the upgrade
              await new Promise(resolve => setTimeout(resolve, 2000));

              // Refresh plan details first to get the latest current plan info and aggregated usage

              await refreshPlanDetails();

              // Then fetch plans to get updated isCurrentPlan flags

              await fetchPlans();

              // Trigger delta sync to update planOrders in IndexedDB

              try {
                const deltaSyncResult = await apiRequest('/data/delta-sync', {
                  method: 'POST',
                  body: {
                    lastFetchTimes: {
                      customers: Date.now(),
                      products: Date.now(),
                      orders: Date.now(),
                      transactions: Date.now(),
                      purchaseOrders: Date.now(),
                      categories: Date.now(),
                      refunds: Date.now(),
                      plans: Date.now(),
                      planOrders: Date.now(), // Force sync planOrders
                      staff: Date.now()
                    }
                  }
                });

                if (deltaSyncResult.success) {

                  // Update UI with synced data
                  const { fetchAllDataWithDeltaSync } = await import('../utils/dataFetcher');
                  const indexedDBData = await fetchAllDataWithDeltaSync();
                  if (indexedDBData) {
                    // Update UI state with fresh IndexedDB data
                    dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: indexedDBData.planOrders || [] });

                  }
                } else {

                }
              } catch (syncError) {

              }

              // Force another refresh of aggregated usage to ensure it's updated

              await new Promise(resolve => setTimeout(resolve, 1000)); // Extra delay
              await refreshPlanDetails();
            } else {
              window.showToast('No internet', 'error');
            }
          } catch (verifyError) {

            window.showToast('No internet', 'error');
          } finally {
            setUpgradingPlanId(null);
          }
        },
        prefill: {
          name: state.currentUser?.name || '',
          email: state.currentUser?.email || '',
          contact: state.currentUser?.phone || ''
        },
        theme: {
          color: '#10b981'
        },
        modal: {
          ondismiss: function() {
            setUpgradingPlanId(null);
            window.showToast('Payment cancelled', 'warning');
          }
        }
      };

      // Open Razorpay checkout
      try {
        const razorpay = new window.Razorpay(options);
        razorpay.on('payment.failed', function (response) {

          window.showToast(`Payment failed: ${response.error.description || response.error.reason || 'Unknown error'}`, 'error');
          setUpgradingPlanId(null);
        });
        razorpay.open();
      } catch (error) {

        window.showToast('Failed to open payment gateway. Please try again.', 'error');
        setUpgradingPlanId(null);
      }

    } catch (err) {

      window.showToast('No internet', 'error');
      setUpgradingPlanId(null);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading plans...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && plans.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center p-8 bg-red-50 rounded-lg border border-red-200 max-w-md">
          <p className="text-red-600 mb-4">Error loading plans: {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // If no plans available
  if (plans.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center p-8">
          <p className="text-gray-600 mb-4">No plans available at the moment.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // Group plans by type
  const groupedPlans = groupPlansByType(plans, hasUsedFreePlan);

  // Plan type options for the first select (exclude free plans if user has used them)
  const planTypeOptions = [
    ...(hasUsedFreePlan ? [] : [{ value: 'free', label: 'Free Plans', icon: '🆓', description: 'Get started with basic features' }]),
    { value: 'mini', label: 'Mini Plans', icon: '➕', description: 'Add-on features to enhance your plan' },
    { value: 'standard', label: 'Standard Plans', icon: '⚫', description: 'Ideal for growing businesses' },
    { value: 'pro', label: 'Pro Plans', icon: '🟧', description: 'Advanced features for established businesses' }
  ];

  // Get plans for selected plan type
  const plansForSelectedType = selectedPlanType ? groupedPlans[selectedPlanType] || [] : [];

  const currentPlan = plans.find(p => p.current) || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 text-white">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-full backdrop-blur-sm mb-6">
              <Crown className="h-8 w-8 text-yellow-300" />
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              Elevate Your Business
            </h1>
            <p className="text-xl sm:text-2xl text-blue-100 max-w-3xl mx-auto leading-relaxed mb-8">
              Unlock premium features and scale your business with our expertly crafted plans
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
                <Check className="h-4 w-4 text-green-300" />
                <span>30-day money back</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
                <Check className="h-4 w-4 text-green-300" />
                <span>No setup fees</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
                <Check className="h-4 w-4 text-green-300" />
                <span>Cancel anytime</span>
              </div>
            </div>
          </div>
        </div>
        {/* Wave separator */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 120" className="w-full h-12 text-slate-50">
            <path fill="currentColor" d="M0,64L48,69.3C96,75,192,85,288,80C384,75,480,53,576,48C672,43,768,53,864,64C960,75,1056,85,1152,80C1248,75,1344,53,1392,42.7L1440,32L1440,120L1392,120C1344,120,1248,120,1152,120C1056,120,960,120,864,120C768,120,672,120,576,120C480,120,384,120,288,120C192,120,96,120,48,120L0,120Z"></path>
          </svg>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

      {/* Error message if plans loaded but there was an initial error */}
      {error && plans.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <p className="text-yellow-800 text-sm">
            ⚠️ Some plans may not be available. Showing available plans.
          </p>
        </div>
      )}

      {/* Current Plan Status */}
      {currentPlan && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-3xl p-8 shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-r from-green-400 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg">
                <Check className="h-8 w-8 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Active Plan</h2>
                <p className="text-green-700 font-semibold">{currentPlan.name}</p>
                <p className="text-sm text-gray-600 mt-1">{currentPlan.description || 'Essential features for your business'}</p>
              </div>
            </div>

            <div className="flex flex-col lg:items-end gap-2">
              <div className="text-center lg:text-right">
                <div className="text-3xl font-black text-gray-900">{currentPlan.price}</div>
                <div className="text-sm text-gray-600">{currentPlan.period || 'per month'}</div>
              </div>
              {sellerPlanInfo && sellerPlanInfo.expiryDate && (
                <div className="text-center lg:text-right">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Expires</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {new Date(sellerPlanInfo.expiryDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Usage Analytics */}
      {(usageCards.length > 0 || activePlanOrdersCount > 0) && (
        <div className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Usage Analytics</h2>
              <p className="text-gray-600">
                Your current resource utilization across all active plans
                {activePlanOrdersCount > 0 && (
                  <span className="ml-1 text-indigo-600 font-medium">
                    ({activePlanOrdersCount} active plan{activePlanOrdersCount === 1 ? '' : 's'})
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={async () => {

                await refreshPlanDetails();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors text-sm font-medium text-gray-700"
              title="Refresh usage data"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          {usageCards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {usageCards.map((card) => {
                const usagePercent = card.summary?.used && card.summary?.limit && card.summary.limit !== 'Unlimited'
                  ? Math.min(100, (card.summary.used / card.summary.limit) * 100)
                  : 0;
                const isNearLimit = usagePercent > 80;

                return (
                  <div key={card.key} className={`p-6 rounded-2xl border-2 transition-all duration-300 ${
                    isNearLimit
                      ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50'
                      : 'border-gray-100 bg-gradient-to-br from-gray-50 to-slate-50'
                  } hover:shadow-lg`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-bold text-gray-500 uppercase tracking-wider">{card.label}</div>
                      {isNearLimit && (
                        <div className="flex items-center gap-1 text-amber-600">
                          <Zap className="h-4 w-4" />
                          <span className="text-xs font-semibold">Near Limit</span>
                        </div>
                      )}
                    </div>

                    <div className="mb-4">
                      <div className="text-3xl font-black text-gray-900 mb-1">
                        {formatUsedValue(card.summary)} <span className="text-gray-400 text-lg">/ {formatLimitValue(card.summary)}</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        {formatRemainingValue(card.summary)} remaining
                      </div>
                    </div>

                    {card.summary?.limit && card.summary.limit !== 'Unlimited' && (
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            isNearLimit ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'
                          }`}
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Plan Type Selection */}
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">Choose Your Journey</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Select the perfect plan category that aligns with your business goals and growth stage
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {planTypeOptions.map((type) => {
            const planCount = groupedPlans[type.value]?.length || 0;
            const isSelected = selectedPlanType === type.value;

            return (
              <button
                key={type.value}
                onClick={() => {
                  setSelectedPlanType(type.value);
                }}
                className={`group relative overflow-hidden rounded-2xl transition-all duration-300 ${
                  isSelected
                    ? 'ring-2 ring-blue-500 shadow-2xl scale-105'
                    : 'hover:scale-102 shadow-lg hover:shadow-xl'
                } ${planCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={planCount === 0}
              >
                {/* Background gradient */}
                <div className={`absolute inset-0 bg-gradient-to-br ${
                  type.value === 'free' ? 'from-emerald-400 to-green-600' :
                  type.value === 'mini' ? 'from-orange-400 to-amber-600' :
                  type.value === 'standard' ? 'from-blue-500 to-indigo-600' :
                  'from-indigo-500 to-purple-600'
                } opacity-90 group-hover:opacity-100 transition-opacity`}></div>

                {/* Content */}
                <div className="relative p-6 text-white">
                  <div className="text-center">
                    <div className="text-4xl mb-4 opacity-90">
                      {type.value === 'free' ? '🎁' : type.value === 'mini' ? '⭐' : type.value === 'standard' ? '📦' : '🏆'}
                    </div>

                    <h3 className="font-bold text-xl mb-3">
                      {type.label}
                    </h3>

                    <p className="text-sm opacity-90 mb-4 leading-relaxed">
                      {type.description}
                    </p>

                    <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2">
                      <span className="text-sm font-medium">{planCount}</span>
                      <span className="text-sm opacity-90">plan{planCount !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>

                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute top-3 right-3 w-6 h-6 bg-white rounded-full flex items-center justify-center">
                    <Check className="h-4 w-4 text-indigo-600" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

        {/* Premium Plan Cards */}
        {selectedPlanType && (
          <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                {planTypeOptions.find(t => t.value === selectedPlanType)?.label || 'Premium Plans'}
              </h2>
              <p className="text-gray-600 mb-6">
                Choose the perfect plan for your business growth
              </p>
              <button
                onClick={() => setSelectedPlanType('')}
                className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
              >
                ← Change Plan Type
              </button>
            </div>

            {plansForSelectedType.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Package className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No plans available</h3>
                <p className="text-gray-600">Please try selecting a different plan type.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
                {plansForSelectedType.map((plan) => {
                  const isPopular = plan.popular && !plan.current;
                  const isCurrent = plan.current;

                  return (
                    <div
                      key={plan.id || plan._id}
                      className={`relative group ${
                        isPopular ? 'lg:scale-105 lg:-translate-y-4' : ''
                      } transition-all duration-300`}
                    >
                      {/* Popular Badge */}
                      {isPopular && (
                        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-20">
                          <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2">
                            <Star className="h-4 w-4 fill-current" />
                            Most Popular
                          </div>
                        </div>
                      )}

                      {/* Current Plan Badge */}
                      {isCurrent && (
                        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-20">
                          <div className="bg-gradient-to-r from-green-400 to-emerald-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2">
                            <Check className="h-4 w-4" />
                            Current Plan
                          </div>
                        </div>
                      )}

                      <div className={`relative overflow-hidden rounded-3xl shadow-2xl ${
                        isCurrent
                          ? 'ring-2 ring-green-300 shadow-green-100'
                          : isPopular
                          ? 'ring-2 ring-amber-300 shadow-amber-100'
                          : 'hover:shadow-3xl'
                      } transition-all duration-300 bg-white`}>

                        {/* Header Gradient */}
                        <div className={`h-32 ${
                          plan.planType === 'free' ? 'bg-gradient-to-r from-green-500 to-emerald-600' :
                          plan.planType === 'mini' ? 'bg-gradient-to-r from-orange-500 to-amber-600' :
                          plan.planType === 'standard' ? 'bg-gradient-to-r from-blue-600 to-indigo-700' :
                          'bg-gradient-to-r from-indigo-600 to-purple-700'
                        } relative overflow-hidden`}>
                          <div className="absolute inset-0 bg-black/10"></div>
                          <div className="absolute top-6 left-6">
                            <h3 className="text-2xl font-bold text-white mb-1">{plan.name}</h3>
                            <div className="flex items-baseline gap-2">
                              <span className="text-4xl font-black text-white">{plan.price}</span>
                              <span className="text-white/80 text-lg">{plan.period}</span>
                            </div>
                          </div>
                          <div className="absolute bottom-6 right-6">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                              plan.planType === 'free' ? 'bg-emerald-500' :
                              plan.planType === 'mini' ? 'bg-amber-500' :
                              plan.planType === 'standard' ? 'bg-blue-500' :
                              'bg-purple-500'
                            }`}>
                              {plan.planType === 'free' ? '🎁' : plan.planType === 'mini' ? '⭐' : plan.planType === 'standard' ? '📦' : '🏆'}
                            </div>
                          </div>
                        </div>

                        {/* Content */}
                        <div className="p-8">
                          {/* Description */}
                          <p className="text-gray-600 text-sm mb-6 leading-relaxed">{plan.description}</p>

                          {/* Limits */}
                          <div className="grid grid-cols-3 gap-4 mb-8 p-4 bg-gray-50 rounded-2xl">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-gray-900 mb-1">
                                {plan.maxCustomers === Infinity || plan.maxCustomers === -1 ? '∞' : plan.maxCustomers}
                              </div>
                              <div className="text-xs text-gray-600 font-medium">Customers</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-gray-900 mb-1">
                                {plan.maxProducts === Infinity || plan.maxProducts === -1 ? '∞' : plan.maxProducts}
                              </div>
                              <div className="text-xs text-gray-600 font-medium">Products</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-gray-900 mb-1">
                                {plan.maxOrders === Infinity || plan.maxOrders === -1 ? '∞' : plan.maxOrders}
                              </div>
                              <div className="text-xs text-gray-600 font-medium">Orders</div>
                            </div>
                          </div>

                          {/* Features */}
                          <div className="space-y-6 mb-8">
                            {/* Unlocked Features */}
                            {plan.unlockedModules && plan.unlockedModules.length > 0 && (
                              <div>
                                <div className="flex items-center gap-2 mb-4">
                                  <Unlock className="h-5 w-5 text-green-600" />
                                  <h4 className="font-bold text-gray-900">Unlocked Features</h4>
                                </div>
                                <ul className="space-y-3">
                                  {plan.unlockedModules.map((module, index) => (
                                    <li key={index} className="flex items-start gap-3">
                                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <Check className="h-3 w-3 text-green-600" />
                                      </div>
                                      <span className="text-sm text-gray-700 font-medium">{module}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Locked Features */}
                            {plan.lockedModules && plan.lockedModules.length > 0 && (
                              <div>
                                <div className="flex items-center gap-2 mb-4">
                                  <Lock className="h-5 w-5 text-gray-400" />
                                  <h4 className="font-bold text-gray-900">Premium Features</h4>
                                </div>
                                <ul className="space-y-3">
                                  {plan.lockedModules.map((module, index) => (
                                    <li key={index} className="flex items-start gap-3 opacity-60">
                                      <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <Lock className="h-3 w-3 text-gray-400" />
                                      </div>
                                      <span className="text-sm text-gray-500">{module}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Action Button */}
                          <div className="text-center">
                            {plan.current ? (
                              <div className="inline-flex items-center justify-center w-full py-4 px-6 bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 rounded-2xl border border-green-200 font-semibold">
                                <Check className="h-5 w-5 mr-2" />
                                <span>Active Plan</span>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePlanSelect(plan.id || plan._id);
                                }}
                                disabled={upgradingPlanId === (plan.id || plan._id)}
                                className={`w-full py-4 px-6 rounded-2xl font-bold text-white transition-all duration-300 transform hover:scale-105 ${
                                  isPopular
                                    ? 'bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 shadow-lg hover:shadow-xl'
                                    : plan.planType === 'free'
                                    ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700'
                                    : plan.planType === 'mini'
                                    ? 'bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700'
                                    : plan.planType === 'standard'
                                    ? 'bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800'
                                    : 'bg-gradient-to-r from-indigo-600 to-purple-700 hover:from-indigo-700 hover:to-purple-800'
                                } disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2`}
                              >
                                {upgradingPlanId === (plan.id || plan._id) ? (
                                  <>
                                    <Loader className="animate-spin h-5 w-5" />
                                    Processing...
                                  </>
                                ) : (
                                  <>
                                    {plan.planType === 'mini' ? 'Top-up' : (plan.userHasThisPlan ? 'Switch Plan' : 'Upgrade Now')}
                                    {!isPopular && <span className="text-lg">→</span>}
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* No plan type selected message */}
        {!selectedPlanType && (
          <div className="bg-gradient-to-br from-gray-50 to-slate-100 border border-gray-200 rounded-3xl p-12 text-center shadow-lg">
            <div className="w-20 h-20 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
              <Package className="h-10 w-10 text-white" />
            </div>

            <h3 className="text-2xl font-bold text-gray-900 mb-4">Choose Your Plan Category</h3>
            <p className="text-gray-600 text-lg max-w-lg mx-auto leading-relaxed">
              Select from the premium plan categories above to explore tailored solutions for your business growth journey.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
              <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm rounded-full px-4 py-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>Flexible scaling</span>
              </div>
              <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm rounded-full px-4 py-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>Premium support</span>
              </div>
              <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm rounded-full px-4 py-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>Advanced features</span>
              </div>
            </div>
          </div>
        )}

        {/* Hidden legacy section */}
        <div className="hidden">
        {plans.map((plan, index) => (
          <div
            key={plan.id || plan._id}
            className={`relative bg-white rounded-2xl shadow-lg border-2 border-primary-200 ${
              plan.popular ? 'ring-2 ring-primary-500 ring-opacity-50' : ''
            } ${plan.current ? 'opacity-75' : ''}`}
          >
            {plan.popular && (
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <div className="bg-primary-500 text-white px-4 py-2 rounded-full text-sm font-semibold flex items-center">
                  <Star className="h-4 w-4 mr-1" />
                  Most Popular
                </div>
              </div>
            )}

            {plan.current && (
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-10">
                <div className="bg-primary-500 text-white px-4 py-2 rounded-full text-sm font-semibold">
                  Current Plan
                </div>
              </div>
            )}

            {!plan.current && plan.userHasThisPlan && plan.planType !== 'mini' && (
              <div className="absolute -top-4 right-4 z-10">
                <div className="bg-primary-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                  You Have This Plan
                </div>
              </div>
            )}

            <div className="p-8">
              <div className="text-center mb-6">
                <div className="text-4xl mb-2">{plan.icon}</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-gray-600 ml-2">{plan.period}</span>
                </div>
                <p className="text-sm text-gray-600 mb-4">{plan.description}</p>
              </div>

              {/* Limits */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-semibold text-gray-900 mb-2">Limits</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Customers:</span>
                    <span className="font-medium">{plan.maxCustomers === Infinity || plan.maxCustomers === -1 ? 'Unlimited' : plan.maxCustomers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Products:</span>
                    <span className="font-medium">{plan.maxProducts === Infinity || plan.maxProducts === -1 ? 'Unlimited' : plan.maxProducts}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Orders:</span>
                    <span className="font-medium">{plan.maxOrders === Infinity || plan.maxOrders === -1 ? 'Unlimited' : plan.maxOrders}</span>
                  </div>
                </div>
              </div>

              {/* Unlocked Modules */}
              {plan.unlockedModules && plan.unlockedModules.length > 0 && (
              <div className="mb-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <Unlock className="h-4 w-4 mr-2 text-primary-500" />
                  Unlocked Modules
                </h4>
                <ul className="space-y-2">
                  {plan.unlockedModules.map((module, moduleIndex) => (
                    <li key={moduleIndex} className="flex items-start">
                      <Check className="h-4 w-4 text-primary-500 mr-2 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-gray-700">{module}</span>
                    </li>
                  ))}
                </ul>
              </div>
              )}

              {/* Locked Modules */}
              {plan.lockedModules && plan.lockedModules.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                    <Lock className="h-4 w-4 mr-2 text-primary-500" />
                    Locked Modules
                  </h4>
                  <ul className="space-y-2">
                    {plan.lockedModules.map((module, moduleIndex) => (
                      <li key={moduleIndex} className="flex items-start">
                        <Lock className="h-4 w-4 text-primary-500 mr-2 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-gray-500">{module}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(!hasValidPlans && plan.price === 0 && plan.planType !== 'mini') && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center">
                    <Shield className="h-4 w-4 text-amber-500 mr-2" />
                    <span className="text-sm text-amber-700">
                      Free plans require an active current plan. Please renew your current plan first.
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={() => handlePlanSelect(plan.id || plan._id)}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-200 ${
                  plan.current
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : upgradingPlanId === (plan.id || plan._id)
                    ? 'bg-gray-400 text-white cursor-wait'
                    : (!hasValidPlans && plan.price === 0 && plan.planType !== 'mini')
                    ? 'bg-gray-400 text-gray-500 cursor-not-allowed'
                    : 'bg-primary-500 hover:bg-primary-600 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-1'
                }`}
                disabled={plan.current || upgradingPlanId === (plan.id || plan._id) || (!hasValidPlans && plan.price === 0 && plan.planType !== 'mini')}
              >
                {plan.current
                  ? 'Current Plan'
                  : upgradingPlanId === (plan.id || plan._id)
                  ? (plan.planType === 'mini' ? 'Topping up...' : plan.userHasThisPlan ? 'Switching...' : 'Upgrading...')
                  : (!hasValidPlans && plan.price === 0 && plan.planType !== 'mini')
                  ? 'Requires Active Subscription'
                  : plan.planType === 'mini'
                  ? 'Top-up'
                  : plan.userHasThisPlan
                  ? 'Switch Plan'
                  : plan.popular
                  ? 'Upgrade Now'
                  : 'Upgrade Plan'}
              </button>
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* Why Choose Us */}
      <div className="bg-white rounded-3xl p-12 shadow-xl border border-gray-100">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Choose Our Platform?</h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Join thousands of businesses that trust our platform for their growth journey
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center group">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl group-hover:shadow-2xl transition-all duration-300">
                <Zap className="h-10 w-10 text-white" />
              </div>
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-orange-400 rounded-full flex items-center justify-center">
                <span className="text-xs font-bold text-white">⚡</span>
              </div>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Lightning Fast Performance</h3>
            <p className="text-gray-600 leading-relaxed">
              Optimized architecture ensures instant operations, real-time sync, and seamless user experience across all devices.
            </p>
          </div>

          <div className="text-center group">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-gradient-to-r from-green-500 to-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl group-hover:shadow-2xl transition-all duration-300">
                <Shield className="h-10 w-10 text-white" />
              </div>
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                <Check className="h-3 w-3 text-white" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Enterprise-Grade Security</h3>
            <p className="text-gray-600 leading-relaxed">
              Your data is encrypted, backed up, and protected with industry-leading security measures and compliance standards.
            </p>
          </div>

          <div className="text-center group">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl group-hover:shadow-2xl transition-all duration-300">
                <Users className="h-10 w-10 text-white" />
              </div>
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center">
                <span className="text-xs font-bold text-white">∞</span>
              </div>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Team Collaboration</h3>
            <p className="text-gray-600 leading-relaxed">
              Powerful collaboration tools enable seamless teamwork, role-based access, and real-time communication across your organization.
            </p>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="bg-white rounded-3xl p-12 shadow-xl border border-gray-100">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Frequently Asked Questions</h2>
          <p className="text-gray-600 text-lg">Everything you need to know about our plans</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-8">
            <div className="border-b border-gray-100 pb-6">
              <h3 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-indigo-600 font-bold text-sm">?</span>
                </div>
                Can I change my plan anytime?
              </h3>
              <p className="text-gray-600 leading-relaxed ml-10">
                Absolutely! You can upgrade, downgrade, or modify your plan at any time. Changes take effect immediately, and we'll prorate any billing adjustments automatically.
              </p>
            </div>

            <div className="border-b border-gray-100 pb-6">
              <h3 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-green-600 font-bold text-sm">💳</span>
                </div>
                What payment methods do you accept?
              </h3>
              <p className="text-gray-600 leading-relaxed ml-10">
                We accept all major credit cards, UPI payments, net banking, and bank transfers. All payments are processed securely through our PCI-compliant payment gateway.
              </p>
            </div>
          </div>

          <div className="space-y-8">
            <div className="border-b border-gray-100 pb-6">
              <h3 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-amber-600 font-bold text-sm">🎁</span>
                </div>
                Is there a free trial?
              </h3>
              <p className="text-gray-600 leading-relaxed ml-10">
                Yes! All paid plans include a 14-day free trial with full access to all features. No credit card required to start. Experience the power of our platform risk-free.
              </p>
            </div>

            <div className="border-b border-gray-100 pb-6">
              <h3 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-bold text-sm">🔒</span>
                </div>
                Is my data secure?
              </h3>
              <p className="text-gray-600 leading-relaxed ml-10">
                Your data security is our top priority. We use enterprise-grade encryption, regular backups, and comply with international security standards. Your business data is always safe with us.
              </p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Upgrade;
