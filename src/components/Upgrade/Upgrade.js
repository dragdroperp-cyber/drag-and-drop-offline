import React, { useState, useEffect } from 'react';
import { useApp, ActionTypes, mergePlanDetailsWithUsage } from '../../context/AppContext';
import { Crown, Check, Star, Zap, Shield, Users, Lock, Unlock, Loader } from 'lucide-react';
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
      console.log('🔄 USAGE UPDATE: Aggregated usage updated:', aggregatedUsage);
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
      console.log('🔄 CURRENT PLAN CHECK: Current plan valid:', hasValidCurrentPlan,
                  'Has used free plan:', hasEverUsedFreePlan,
                  'Current plan ID:', currentPlanId,
                  'Current plan order found:', !!currentPlanOrder,
                  'Total plan orders:', planOrders.length);
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
          console.log('🔄 PLAN UPDATE: Current plan state:', state.currentPlan);
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
      console.error('Error fetching plans:', err);
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
    console.log('Plans grouped by type:', {
      free: grouped.free.length,
      mini: grouped.mini.length,
      standard: grouped.standard.length,
      pro: grouped.pro.length,
      total: plans.length
    });
    
    return grouped;
  };

  // Helper function to refresh plan details
  const refreshPlanDetails = async () => {
    try {
      const [planResult, usageResult] = await Promise.all([
        apiRequest(`/data/current-plan?_t=${Date.now()}`),
        apiRequest('/plans/usage')
      ]);

      const planPayload = planResult.success && planResult.data
        ? (Array.isArray(planResult.data) ? planResult.data : planResult.data.data || planResult.data)
        : null;

      const usagePayload = usageResult.success && usageResult.data && usageResult.data.summary
        ? usageResult.data
        : null;

      // Store aggregated usage from all valid plan orders
      if (usagePayload && usagePayload.summary) {
        console.log('🔄 PLAN REFRESH: Updating aggregated usage:', usagePayload.summary);
        setAggregatedUsage(usagePayload.summary);
      }

      let combinedPlanDetails = mergePlanDetailsWithUsage(planPayload, usagePayload);
      if (!combinedPlanDetails && planPayload) {
        combinedPlanDetails = { ...planPayload };
      }

      if (combinedPlanDetails) {
        console.log('🔄 PLAN REFRESH: Setting current plan details:', combinedPlanDetails);
        dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combinedPlanDetails });
        if (combinedPlanDetails.planId) {
          console.log('🔄 PLAN REFRESH: Setting current plan to:', combinedPlanDetails.planId);
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combinedPlanDetails.planId });
        }
      }
    } catch (planError) {
      console.error('Error refreshing plan details:', planError);
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
          console.log('🔄 PLAN SWITCH: Syncing updated plan orders to IndexedDB...');
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
              console.log('✅ PLAN SWITCH: Plan orders synced to IndexedDB');
              // Update UI with synced data
              const { fetchAllDataWithDeltaSync } = await import('../utils/dataFetcher');
              const indexedDBData = await fetchAllDataWithDeltaSync();
              if (indexedDBData) {
                // Update UI state with fresh IndexedDB data
                dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: indexedDBData.planOrders || [] });
                console.log('✅ PLAN SWITCH: UI updated with synced plan orders');
              }
            } else {
              console.warn('⚠️ PLAN SWITCH: Failed to sync plan orders:', deltaSyncResult.message);
            }
          } catch (syncError) {
            console.error('❌ PLAN SWITCH: Error syncing plan orders:', syncError);
          }

          await fetchPlans();
          await refreshPlanDetails();
        } else {
          const message = result.message || result.error || 'Unable to switch plan right now.';
          window.showToast(message, 'error');
        }
      } catch (err) {
        console.error('Error switching plan:', err);
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
        console.error('Error upgrading plan:', err);
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
            console.log('🔄 PLAN UPGRADE: Setting current plan to:', planId);
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
          }
          const message = isMiniPlan 
            ? `Successfully topped up with ${upgradeData?.planName || selectedPlan?.name || 'selected plan'}!`
            : `Successfully upgraded to ${upgradeData?.planName || selectedPlan?.name || 'selected plan'}!`;
          window.showToast(message, 'success');

          // Add a delay to allow backend to process the upgrade
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Refresh plan details first to get the latest current plan info and aggregated usage
          console.log('🔄 PLAN UPGRADE: Refreshing plan details after upgrade...');
          await refreshPlanDetails();

          // Then fetch plans to get updated isCurrentPlan flags
          console.log('🔄 PLAN UPGRADE: Fetching updated plans list...');
          await fetchPlans();

          // Trigger delta sync to update planOrders in IndexedDB
          console.log('🔄 PLAN UPGRADE: Syncing updated plan orders to IndexedDB...');
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
              console.log('✅ PLAN UPGRADE: Plan orders synced to IndexedDB');
              // Update UI with synced data
              const { fetchAllDataWithDeltaSync } = await import('../utils/dataFetcher');
              const indexedDBData = await fetchAllDataWithDeltaSync();
              if (indexedDBData) {
                // Update UI state with fresh IndexedDB data
                dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: indexedDBData.planOrders || [] });
                console.log('✅ PLAN UPGRADE: UI updated with synced plan orders');
              }
            } else {
              console.warn('⚠️ PLAN UPGRADE: Failed to sync plan orders:', deltaSyncResult.message);
            }
          } catch (syncError) {
            console.error('❌ PLAN UPGRADE: Error syncing plan orders:', syncError);
          }

          // Force another refresh of aggregated usage to ensure it's updated
          console.log('🔄 PLAN UPGRADE: Double-checking aggregated usage...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Extra delay
          await refreshPlanDetails();
        }
        setUpgradingPlanId(null);
        return;
      }

      const { orderId, amount, currency, key } = responseData;

      // Validate that key exists
      if (!key) {
        console.error('Razorpay key is missing from response:', responseData);
        window.showToast('Payment configuration error. Please contact support.', 'error');
        setUpgradingPlanId(null);
        return;
      }

      // Validate that Razorpay script is loaded
      if (!window.Razorpay) {
        console.error('Razorpay script is not loaded');
        window.showToast('Payment gateway is not available. Please refresh the page.', 'error');
        setUpgradingPlanId(null);
        return;
      }

      // Validate required payment details
      if (!orderId || !amount || !currency) {
        console.error('Missing payment details:', { orderId, amount, currency, key });
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
              console.log('🔄 PLAN UPGRADE: Refreshing plan details after upgrade...');
              await refreshPlanDetails();

              // Then fetch plans to get updated isCurrentPlan flags
              console.log('🔄 PLAN UPGRADE: Fetching updated plans list...');
              await fetchPlans();

              // Trigger delta sync to update planOrders in IndexedDB
              console.log('🔄 PLAN UPGRADE: Syncing updated plan orders to IndexedDB...');
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
                  console.log('✅ PLAN UPGRADE: Plan orders synced to IndexedDB');
                  // Update UI with synced data
                  const { fetchAllDataWithDeltaSync } = await import('../utils/dataFetcher');
                  const indexedDBData = await fetchAllDataWithDeltaSync();
                  if (indexedDBData) {
                    // Update UI state with fresh IndexedDB data
                    dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: indexedDBData.planOrders || [] });
                    console.log('✅ PLAN UPGRADE: UI updated with synced plan orders');
                  }
                } else {
                  console.warn('⚠️ PLAN UPGRADE: Failed to sync plan orders:', deltaSyncResult.message);
                }
              } catch (syncError) {
                console.error('❌ PLAN UPGRADE: Error syncing plan orders:', syncError);
              }

              // Force another refresh of aggregated usage to ensure it's updated
              console.log('🔄 PLAN UPGRADE: Double-checking aggregated usage...');
              await new Promise(resolve => setTimeout(resolve, 1000)); // Extra delay
              await refreshPlanDetails();
            } else {
              window.showToast('No internet', 'error');
            }
          } catch (verifyError) {
            console.error('Payment verification error:', verifyError);
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
          console.error('Payment failed:', response.error);
          window.showToast(`Payment failed: ${response.error.description || response.error.reason || 'Unknown error'}`, 'error');
          setUpgradingPlanId(null);
        });
        razorpay.open();
      } catch (error) {
        console.error('Error opening Razorpay checkout:', error);
        window.showToast('Failed to open payment gateway. Please try again.', 'error');
        setUpgradingPlanId(null);
      }

    } catch (err) {
      console.error('Error initiating payment:', err);
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
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Choose Your Plan
        </h1>

        <p className="text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed mb-8">
          Select the perfect plan for your business needs. All plans include our core features with different limits and capabilities.
        </p>

        {/* Simple Instructions */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-w-lg mx-auto">
          <p className="text-gray-700 text-sm">
            Choose a plan type below, then select your preferred plan to upgrade instantly.
          </p>
        </div>
      </div>

      {/* Error message if plans loaded but there was an initial error */}
      {error && plans.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <p className="text-yellow-800 text-sm">
            ⚠️ Some plans may not be available. Showing available plans.
          </p>
        </div>
      )}

      {/* Current Subscription Status - Only show if user has a current plan */}
      {currentPlan && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
              <Check className="h-5 w-5 text-green-600" />
            </div>
          <div>
              <h2 className="text-lg font-semibold text-gray-900">Current Plan</h2>
              <p className="text-sm text-gray-600">Your active subscription</p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">{currentPlan.price}</div>
            <div className="text-sm text-gray-600">{currentPlan.period || 'per month'}</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900">{currentPlan.name}</div>
              <div className="text-sm text-gray-600">{currentPlan.description || 'Essential features for your business'}</div>
            </div>

            {sellerPlanInfo && sellerPlanInfo.expiryDate && (
              <div className="text-right">
                <div className="text-xs text-gray-500">Expires</div>
                <div className="text-sm font-medium text-gray-900">
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

      {(usageCards.length > 0 || activePlanOrdersCount > 0) && (
        <div className="bg-white rounded-xl p-6 shadow-sm mb-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Total Usage Across All Plans</h2>
                {activePlanOrdersCount > 0 && (
                  <p className="text-sm text-gray-600 mt-1">
                    Combined limits from {activePlanOrdersCount} active plan{activePlanOrdersCount === 1 ? '' : 's'}.
                  </p>
                )}
              </div>
              <button
                onClick={async () => {
                  console.log('🔄 MANUAL REFRESH: Refreshing usage data...');
                  await refreshPlanDetails();
                }}
                className="text-sm text-gray-500 hover:text-gray-700 underline flex items-center"
                title="Refresh usage data"
              >
                <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          </div>
          {usageCards.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              {usageCards.map((card) => (
                <div key={card.key} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{card.label}</div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {formatUsedValue(card.summary)} / {formatLimitValue(card.summary)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Remaining: {formatRemainingValue(card.summary)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Plan Selection */}
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Plan Type Selection */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Plan Type</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {planTypeOptions.map((type) => {
              const planCount = groupedPlans[type.value]?.length || 0;
              const isSelected = selectedPlanType === type.value;

              return (
                <button
                  key={type.value}
                  onClick={() => {
                    setSelectedPlanType(type.value);
                  }}
                  className={`p-6 rounded-xl border-2 transition-all duration-200 ${
                    isSelected
                      ? 'border-gray-900 bg-gray-50 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  } ${planCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={planCount === 0}
                >
                  <div className="text-center">
                    <div className={`text-3xl mb-3 ${isSelected ? 'text-gray-900' : 'text-gray-600'}`}>
                      {type.value === 'free' ? '🎁' : type.value === 'mini' ? '⭐' : type.value === 'standard' ? '📦' : '🏆'}
                    </div>

                    <h3 className={`font-bold text-lg mb-2 ${isSelected ? 'text-gray-900' : 'text-gray-900'}`}>
                      {type.label}
                    </h3>

                    <p className="text-sm text-gray-600 mb-3 leading-relaxed">
                      {type.description}
                    </p>

                    <div className={`text-xs font-medium px-3 py-1 rounded-full ${
                      isSelected ? 'bg-gray-200 text-gray-800' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {planCount} plan{planCount !== 1 ? 's' : ''} available
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Plan Selection Grid */}
        {selectedPlanType && (
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">
                {planTypeOptions.find(t => t.value === selectedPlanType)?.label || 'Plans'}
              </h3>
              <button
                onClick={() => {
                  setSelectedPlanType('');
                }}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Change Plan Type
              </button>
            </div>

            {plansForSelectedType.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No plans available for this type.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plansForSelectedType.map((plan) => (
                  <div
                    key={plan.id || plan._id}
                    className={`relative bg-white rounded-xl border transition-all duration-200 ${
                      plan.current
                        ? 'border-green-300 bg-green-50/50 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300 hover:shadow-lg'
                    }`}
                  >
                    {/* Status Badge */}
                    <div className="absolute -top-3 left-6">
                      {plan.current && (
                        <span className="bg-green-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                          Current Plan
                        </span>
                      )}
                      {plan.popular && !plan.current && (
                        <span className="bg-amber-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                          Most Popular
                        </span>
                      )}
                      {!plan.current && plan.userHasThisPlan && plan.planType !== 'mini' && (
                        <span className="bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                          Owned
                        </span>
                      )}
                    </div>

                    <div className="p-8">
                      {/* Plan Header */}
                      <div className="text-center mb-8">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                        <div className="flex items-center justify-center mb-4">
                          <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                          <span className="text-gray-600 ml-2 text-lg">{plan.period}</span>
                        </div>
                        <p className="text-gray-600 text-sm leading-relaxed max-w-xs mx-auto">{plan.description}</p>
                      </div>

                      {/* Plan Features */}
                      <div className="space-y-4 mb-8">
                        <div className="border-t border-gray-100 pt-4">
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                              <div className="text-2xl font-bold text-gray-900 mb-1">
                                {plan.maxCustomers === Infinity || plan.maxCustomers === -1 ? '∞' : plan.maxCustomers}
                              </div>
                              <div className="text-xs text-gray-600 font-medium">Customers</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-gray-900 mb-1">
                                {plan.maxProducts === Infinity || plan.maxProducts === -1 ? '∞' : plan.maxProducts}
                              </div>
                              <div className="text-xs text-gray-600 font-medium">Products</div>
                            </div>
                            <div>
                              <div className="text-2xl font-bold text-gray-900 mb-1">
                                {plan.maxOrders === Infinity || plan.maxOrders === -1 ? '∞' : plan.maxOrders}
                              </div>
                              <div className="text-xs text-gray-600 font-medium">Orders</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="text-center">
                        {plan.current ? (
                          <div className="inline-flex items-center justify-center w-full py-4 px-6 bg-green-50 text-green-700 rounded-lg border border-green-200">
                            <Check className="h-5 w-5 mr-2" />
                            <span className="font-semibold">Active Plan</span>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlanSelect(plan.id || plan._id);
                            }}
                            disabled={upgradingPlanId === (plan.id || plan._id)}
                            className="w-full py-4 px-6 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-semibold transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                          >
                            {upgradingPlanId === (plan.id || plan._id) ? (
                              <>
                                <Loader className="animate-spin h-5 w-5 mr-2" />
                                Processing...
                              </>
                            ) : (
                              <span>
                                {plan.planType === 'mini' ? 'Top-up' : (plan.userHasThisPlan ? 'Switch Plan' : 'Select Plan')}
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No plan type selected message */}
        {!selectedPlanType && (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-gray-600 text-lg">📋</span>
            </div>

            <h3 className="text-lg font-semibold text-gray-900 mb-2">Select a Plan Type</h3>
            <p className="text-gray-600 text-sm max-w-sm mx-auto">
              Choose from the plan categories above to view available plans and pricing options.
            </p>
          </div>
        )}

        {/* Legacy Plans Grid (Hidden) */}
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

      {/* Features Comparison */}
      <div className="bg-white rounded-xl p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Feature Comparison</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="p-4 bg-primary-50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Zap className="h-8 w-8 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Lightning Fast</h3>
            <p className="text-gray-600">Optimized performance for quick operations</p>
          </div>
          
          <div className="text-center">
            <div className="p-4 bg-primary-50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Shield className="h-8 w-8 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Secure & Reliable</h3>
            <p className="text-gray-600">Your data is safe with enterprise-grade security</p>
          </div>
          
          <div className="text-center">
            <div className="p-4 bg-primary-50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Users className="h-8 w-8 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Team Collaboration</h3>
            <p className="text-gray-600">Work together with your team seamlessly</p>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="bg-white rounded-xl p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Can I change my plan anytime?</h3>
            <p className="text-gray-600">Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.</p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Is there a free trial?</h3>
            <p className="text-gray-600">Yes, all paid plans come with a 14-day free trial. No credit card required.</p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">What payment methods do you accept?</h3>
            <p className="text-gray-600">We accept all major credit cards, UPI, and bank transfers.</p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Upgrade;




