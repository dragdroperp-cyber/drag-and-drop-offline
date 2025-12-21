import React, { useState, useEffect } from 'react';
import { useApp, ActionTypes, mergePlanDetailsWithUsage, triggerSyncStatusUpdate } from '../../context/AppContext';
import { Crown, Check, Star, Zap, Shield, Users, Lock, Unlock, Loader, Package, X, ArrowRight } from 'lucide-react';
import { apiRequest } from '../../utils/api';

const Upgrade = () => {
  const { state, dispatch } = useApp();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(() => {
    // Skip loading if plan details are already available
    return !state.currentPlanDetails;
  });
  const [error, setError] = useState(null);
  const [sellerPlanInfo, setSellerPlanInfo] = useState(null);
  const [activePlanOrdersCount, setActivePlanOrdersCount] = useState(0);
  const [upgradingPlanId, setUpgradingPlanId] = useState(null);
  const [selectedPlanType, setSelectedPlanType] = useState('');
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [aggregatedUsage, setAggregatedUsage] = useState(null);
  const [hasValidPlans, setHasValidPlans] = useState(false);
  const [hasUsedFreePlan, setHasUsedFreePlan] = useState(false);
  const [usagePlans, setUsagePlans] = useState([]); // Plan orders from /data/plans API

  // Load Razorpay script dynamically if not available
  const loadRazorpayScript = () => {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (window.Razorpay) {
        resolve(true);
        return;
      }

      // Check if script is already in DOM
      const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
      if (existingScript) {
        // Wait for it to load with timeout
        const timeout = setTimeout(() => {
          reject(new Error('Razorpay script load timeout'));
        }, 10000); // 10 second timeout

        existingScript.addEventListener('load', () => {
          clearTimeout(timeout);
          resolve(true);
        });
        existingScript.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Failed to load Razorpay script'));
        });
        return;
      }

      // Load the script dynamically
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;

      const timeout = setTimeout(() => {
        reject(new Error('Razorpay script load timeout'));
      }, 10000); // 10 second timeout

      script.onload = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load Razorpay script'));
      };

      document.head.appendChild(script);
    });
  };

  // Use aggregated usage from all valid plan orders instead of just current plan
  const usageCards = aggregatedUsage
    ? [
      { key: 'customers', label: 'Customers', summary: aggregatedUsage.customers },
      { key: 'products', label: 'Products', summary: aggregatedUsage.products },
      { key: 'orders', label: 'Orders', summary: aggregatedUsage.orders }
    ].filter(card => card.summary)
    : [];

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

      // Check if user has ever used a free plan
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

  const fetchPlans = async () => {
    try {
      setError(null);
      const result = await apiRequest(`/data/plans?_t=${Date.now()}`);

      if (result.planInvalid) {
        setError('Your plan has expired. Please select a plan below to continue.');
        return;
      }

      if (result.success && result.data) {
        const responseData = result.data.data || result.data;
        let plansData = Array.isArray(responseData) ? responseData : (responseData.data || []);
        let planInfo = responseData.sellerPlanInfo || result.data.sellerPlanInfo;
        let planCount = responseData.activePlanOrdersCount || result.data.activePlanOrdersCount || 0;
        let planOrders = responseData.usagePlans || result.data.usagePlans || [];

        if (Array.isArray(plansData)) {
          const formattedPlans = plansData.map(plan => ({
            ...plan,
            planType: plan.planType || 'standard',
            current: plan.isCurrentPlan !== undefined
              ? plan.isCurrentPlan
              : (state.currentPlan === plan.id || state.currentPlan === plan._id)
          }));
          setPlans(formattedPlans);
          if (planInfo) setSellerPlanInfo(planInfo);
          if (planCount > 0) setActivePlanOrdersCount(planCount);
          if (Array.isArray(planOrders)) setUsagePlans(planOrders);
        } else {
          setError('Invalid plans data format');
        }
      } else {
        setError('Unable to load plans');
      }
    } catch (err) {
      setError('Connection error');
    }
  };

  const refreshPlanDetails = async () => {
    try {
      const [planResult, usageResult] = await Promise.all([
        apiRequest(`/data/current-plan?_t=${Date.now()}`),
        apiRequest(`/plans/usage?_t=${Date.now()}`)
      ]);

      if (planResult.planInvalid || usageResult.planInvalid) return;

      const planPayload = planResult.success && planResult.data
        ? (planResult.data.data || planResult.data)
        : null;

      const usagePayload = usageResult.success && usageResult.data && usageResult.data.summary
        ? usageResult.data
        : null;

      if (usagePayload && usagePayload.summary) {
        setAggregatedUsage(usagePayload.summary);
      }

      let combinedPlanDetails = mergePlanDetailsWithUsage(planPayload, usagePayload);
      if (combinedPlanDetails) {
        dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combinedPlanDetails, cacheInIndexedDB: true });
        if (combinedPlanDetails.planId) {
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combinedPlanDetails.planId });
        }
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: !combinedPlanDetails.isExpired });
      }
    } catch (err) { }
  };

  useEffect(() => {
    const loadPlans = async () => {
      setLoading(true);
      await fetchPlans();
      await refreshPlanDetails();
      setLoading(false);
    };
    loadPlans();
  }, [state.currentPlan]);

  const handlePlanSelect = async (planId) => {
    const selectedPlan = plans.find(p => p.id === planId || p._id === planId);
    if (!selectedPlan) {
      window.showToast('Plan selection failed. Please try again.', 'error');
      return;
    }
    if (selectedPlan.current) return;

    setUpgradingPlanId(planId);
    try {
      // Check if user already has a valid plan order for this specific plan
      const targetPlanId = selectedPlan._id || selectedPlan.id;
      const validOrder = usagePlans.find(order =>
        order.planId === targetPlanId &&
        !order.isExpired &&
        order.status !== 'expired'
      );

      if (validOrder) {
        // Switch to existing valid plan order
        const orderId = validOrder.planOrderId;

        const switchResult = await apiRequest('/plans/switch', {
          method: 'POST',
          body: { planOrderId: orderId }
        });

        if (switchResult.success) {
          window.showToast(`Switched to ${selectedPlan.name} successfully!`, 'success');
          // Update state and refresh
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: selectedPlan._id || selectedPlan.id });
          window.location.reload();
          return;
        } else {
          window.showToast(switchResult.message || 'Failed to switch plan', 'error');
          return;
        }
      }

      const planPrice = selectedPlan?.rawPrice || parseFloat(selectedPlan?.price?.replace('₹', '') || '0');
      const isMiniPlan = selectedPlan?.planType === 'mini';

      if (planPrice === 0 && !isMiniPlan) {
        const result = await apiRequest('/data/plans/upgrade', { method: 'POST', body: { planId } });
        if (result.success) {
          window.showToast(`Successfully upgraded to ${selectedPlan.name}!`, 'success');
          window.location.reload();
        } else {
          window.showToast(result.message || 'Upgrade failed', 'error');
        }
      } else {
        // Razorpay logic...
        const orderResult = await apiRequest('/data/plans/create-razorpay-order', { method: 'POST', body: { planId } });

        if (orderResult.success && orderResult.data) {
          const resultData = orderResult.data.data || orderResult.data;

          if (!resultData.orderId || !resultData.key) {
            window.showToast('Invalid payment configuration from server', 'error');
            return;
          }

          const poId = resultData.planOrderId;

          await loadRazorpayScript();

          if (!window.Razorpay) {
            window.showToast('Payment system could not be initialized. Please refresh.', 'error');
            return;
          }

          const options = {
            key: resultData.key,
            amount: resultData.amount,
            currency: resultData.currency,
            name: 'Drag & Drop',
            order_id: resultData.orderId,
            handler: async (response) => {
              const verify = await apiRequest('/data/plans/verify-razorpay-payment', {
                method: 'POST',
                body: {
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                  planId,
                  planOrderId: poId
                }
              });
              if (verify.success) {
                window.showToast('Payment successful!', 'success');
                window.location.reload();
              }
            },
            prefill: {
              name: state.currentUser?.name,
              email: state.currentUser?.email
            },
            theme: { color: '#2F3C7E' }
          };
          const rzp1 = new window.Razorpay(options);
          rzp1.open();
        }
      }
    } catch (err) {
      window.showToast('Something went wrong', 'error');
    } finally {
      setUpgradingPlanId(null);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900"><Loader className="animate-spin h-10 w-10 text-[#2F3C7E]" /></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors duration-500">
      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#2F3C7E] via-[#3d4a8f] to-[#2F3C7E] dark:from-slate-800 dark:via-blue-900/40 dark:to-slate-800 text-white">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-full backdrop-blur-sm mb-6 dark:bg-white/5">
            <Crown className="h-8 w-8 text-[#F4A259]" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight dark:text-white">Elevate Your Business</h1>
          <p className="text-xl sm:text-2xl text-blue-100 max-w-3xl mx-auto mb-8 dark:text-slate-300">Unlock premium features and scale with our brand themed plans</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* All Plans Section */}
        <div className="space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Choose Your Perfect Plan</h2>
            <p className="text-gray-600 dark:text-slate-400">Select the plan that best fits your business needs</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
            {plans.map((plan) => {
              const isPopular = plan.popular && !plan.current;
              const isCurrent = plan.current;

              return (
                <div key={plan.id || plan._id} className={`relative group transition-all duration-300 ${isPopular ? 'lg:scale-105 lg:-translate-y-4' : ''}`}>
                  {isPopular && (
                    <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-20">
                      <div className="bg-gradient-to-r from-[#F4A259] to-orange-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2">
                        <Star className="h-4 w-4 fill-current" /> Most Popular
                      </div>
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-20">
                      <div className="bg-gradient-to-r from-green-400 to-emerald-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2">
                        <Check className="h-4 w-4" /> Current Plan
                      </div>
                    </div>
                  )}

                  <div className={`relative overflow-hidden rounded-3xl shadow-2xl bg-white dark:bg-slate-800 transition-all duration-300 ${isCurrent ? 'ring-2 ring-green-300 dark:ring-green-500/50' : isPopular ? 'ring-2 ring-[#F4A259]/30' : 'hover:shadow-3xl'} dark:border dark:border-slate-700`}>
                    {/* Header Gradient - Brand Themed */}
                    <div className="h-32 bg-gradient-to-br from-[#2F3C7E] via-[#3d4a8f] to-[#2F3C7E] dark:from-slate-700 dark:to-slate-800 relative overflow-hidden">
                      <div className="absolute top-6 left-6">
                        <h3 className="text-2xl font-bold text-white mb-1">{plan.name}</h3>
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-black text-white">{plan.price}</span>
                          <span className="text-white/80 text-lg">/{plan.period}</span>
                        </div>
                      </div>
                      <div className="absolute bottom-6 right-6">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[#F4A259] shadow-lg">
                          {plan.planType === 'free' ? '🎁' : plan.planType === 'mini' ? '⭐' : plan.planType === 'standard' ? '📦' : '🏆'}
                        </div>
                      </div>
                    </div>

                    <div className="p-8">
                      <p className="text-gray-600 dark:text-slate-400 text-sm mb-6 leading-relaxed">{plan.description}</p>

                      <div className="grid grid-cols-3 gap-4 mb-8 p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{plan.maxCustomers === Infinity || plan.maxCustomers === -1 ? '∞' : plan.maxCustomers}</div>
                          <div className="text-xs text-gray-600 dark:text-slate-500">Customers</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{plan.maxProducts === Infinity || plan.maxProducts === -1 ? '∞' : plan.maxProducts}</div>
                          <div className="text-xs text-gray-600 dark:text-slate-500">Products</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{plan.maxOrders === Infinity || plan.maxOrders === -1 ? '∞' : plan.maxOrders}</div>
                          <div className="text-xs text-gray-600 dark:text-slate-500">Orders</div>
                        </div>
                      </div>

                      <div className="text-center">
                        {isCurrent ? (
                          <div className="inline-flex items-center justify-center w-full py-4 px-6 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 rounded-2xl border-2 border-green-100 dark:border-green-500/20 font-bold shadow-sm">
                            <Check className="h-5 w-5 mr-2" /> Current Active Plan
                          </div>
                        ) : (
                          <button
                            onClick={() => setCheckoutPlan(plan)}
                            disabled={upgradingPlanId === (plan.id || plan._id)}
                            className="w-full py-4 px-6 rounded-2xl font-bold text-white transition-all duration-300 transform hover:scale-105 bg-gradient-to-r from-[#2F3C7E] to-[#3d4a8f] dark:from-blue-600 dark:to-indigo-600 shadow-lg relative overflow-hidden group"
                          >
                            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                            <div className="relative z-10 flex items-center justify-center gap-2">
                              {upgradingPlanId === (plan.id || plan._id) ? <Loader className="animate-spin h-5 w-5" /> : <span>🚀 View Details →</span>}
                            </div>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Premium Checkout Modal */}
      {/* Balanced Premium Checkout Modal */}
      {checkoutPlan && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4 sm:p-6 animate-fadeIn"
          onClick={() => setCheckoutPlan(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full max-w-2xl max-h-[90vh] rounded-[2rem] shadow-2xl flex flex-col animate-slideUp relative overflow-hidden dark:border dark:border-slate-700"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#2F3C7E] to-[#3d4a8f] dark:from-slate-700 dark:to-slate-800 p-8 text-white relative">
              <button
                onClick={() => setCheckoutPlan(null)}
                className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="h-6 w-6" />
              </button>
              <h3 className="text-3xl font-bold mb-2">{checkoutPlan.name}</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black">{checkoutPlan.price}</span>
                <span className="text-white/70">/{checkoutPlan.period}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 dark:scrollbar-thumb-slate-700">
              {/* Features/Limits */}
              <div>
                <h4 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-4">Plan Limits</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700">
                    <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">{checkoutPlan.maxCustomers === Infinity || checkoutPlan.maxCustomers === -1 ? '∞' : checkoutPlan.maxCustomers}</div>
                    <div className="text-xs text-gray-600 dark:text-slate-500">Customers</div>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700">
                    <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">{checkoutPlan.maxProducts === Infinity || checkoutPlan.maxProducts === -1 ? '∞' : checkoutPlan.maxProducts}</div>
                    <div className="text-xs text-gray-600 dark:text-slate-500">Products</div>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700">
                    <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">{checkoutPlan.maxOrders === Infinity || checkoutPlan.maxOrders === -1 ? '∞' : checkoutPlan.maxOrders}</div>
                    <div className="text-xs text-gray-600 dark:text-slate-500">Orders</div>
                  </div>
                </div>
              </div>

              {/* Modules */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-4">Unlocked Features</h4>
                  <div className="space-y-3">
                    {checkoutPlan.unlockedModules && checkoutPlan.unlockedModules.length > 0 ? (
                      checkoutPlan.unlockedModules.map((module, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-gray-700 dark:text-slate-200">
                          <Check className="h-4 w-4 text-green-500" />
                          <span className="text-sm font-medium">{module}</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-gray-400 italic">No modules unlocked</span>
                    )}
                  </div>
                </div>
                {checkoutPlan.lockedModules?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-4">Locked Features</h4>
                    <div className="space-y-3">
                      {checkoutPlan.lockedModules.map((module, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-gray-400 dark:text-slate-500">
                          <Lock className="h-4 w-4" />
                          <span className="text-sm font-medium">{module}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-8 border-t dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 backdrop-blur-sm">
              <button
                onClick={() => handlePlanSelect(checkoutPlan.id || checkoutPlan._id)}
                disabled={upgradingPlanId}
                className="w-full py-4 bg-[#2F3C7E] dark:bg-blue-600 text-white rounded-2xl font-bold shadow-lg hover:bg-[#3d4a8f] dark:hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
              >
                {upgradingPlanId ? (
                  <Loader className="animate-spin h-5 w-5" />
                ) : (
                  <>
                    <span>
                      {(() => {
                        const targetPlanId = checkoutPlan._id || checkoutPlan.id;
                        const hasValidOrder = usagePlans.some(order =>
                          order.planId === targetPlanId &&
                          !order.isExpired &&
                          order.status !== 'expired'
                        );
                        return hasValidOrder ? 'Switch Plan' : 'Confirm Upgrade';
                      })()}
                    </span>
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </button>
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-gray-400 dark:text-slate-500">
                  <Shield className="h-4 w-4" />
                  <span className="text-xs font-medium">Secure Payment via Razorpay</span>
                </div>
                <img
                  referrerPolicy="origin"
                  src={state.darkMode ? "https://badges.razorpay.com/badge-dark.png" : "https://badges.razorpay.com/badge-light.png"}
                  style={{ height: '35px', width: '88px' }}
                  alt="Razorpay Badge"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Upgrade;
