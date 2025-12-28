import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes, mergePlanDetailsWithUsage, triggerSyncStatusUpdate } from '../../context/AppContext';
import { Crown, Check, Star, Zap, Shield, Users, Lock, Unlock, Loader, Package, X, ArrowRight, History } from 'lucide-react';
import { apiRequest } from '../../utils/api';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';

const Upgrade = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
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

  const [activeCategory, setActiveCategory] = useState('standard');
  const [isClosing, setIsClosing] = useState(false);

  // Handle closing animation
  const handleCloseCheckout = () => {
    setIsClosing(true);
    setTimeout(() => {
      setCheckoutPlan(null);
      setIsClosing(false);
    }, 400);
  };

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
            planType: plan.planType || (plan.rawPrice === 0 ? 'free' : 'standard'),
            current: plan.planType !== 'mini' &&
              planInfo &&
              !planInfo.isExpired &&
              (String(planInfo.currentPlanId) === String(plan.id) || String(planInfo.currentPlanId) === String(plan._id))
          }));
          setPlans(formattedPlans);

          // If current category has no plans, switch to one that does
          const categories = ['free', 'standard', 'pro', 'mini'];
          const counts = categories.reduce((acc, cat) => {
            acc[cat] = formattedPlans.filter(p => p.planType === cat).length;
            return acc;
          }, {});

          if (counts[activeCategory] === 0) {
            const firstAvailable = categories.find(cat => counts[cat] > 0);
            if (firstAvailable) setActiveCategory(firstAvailable);
          }

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

  const handlePlanSelect = async (planId, e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const selectedPlan = plans.find(p => p.id === planId || p._id === planId);
    if (!selectedPlan) {
      window.showToast('Plan selection failed. Please try again.', 'error');
      return;
    }
    if (selectedPlan.current && selectedPlan.planType !== 'mini') return;

    setUpgradingPlanId(planId);
    try {
      // Check if user already has a valid plan order for this specific plan
      const targetPlanId = selectedPlan._id || selectedPlan.id;
      const validOrder = usagePlans.find(order =>
        order.planId === targetPlanId &&
        !order.isExpired &&
        order.status !== 'expired'
      );

      if (validOrder && selectedPlan.planType !== 'mini') {
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
                  planId
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
      <style>{`
        @keyframes strikeAnimation {
          0% { width: 0; opacity: 1; }
          40% { width: 100%; opacity: 1; }
          85% { width: 100%; opacity: 1; }
          100% { width: 100%; opacity: 0; }
        }
        @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
        @keyframes slideDown {
            from { transform: translateY(0); }
            to { transform: translateY(100%); }
        }
      `}</style>
      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#2F3C7E] via-[#3d4a8f] to-[#2F3C7E] dark:from-slate-800 dark:via-blue-900/40 dark:to-slate-800 text-white">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative max-w-[95rem] mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-full backdrop-blur-sm mb-6 dark:bg-white/5">
            <Crown className="h-8 w-8 text-[#F4A259]" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight dark:text-white">Elevate Your Business</h1>
          <p className="text-xl sm:text-2xl text-blue-100 max-w-3xl mx-auto mb-8 dark:text-slate-300">Unlock premium features and scale with our brand themed plans</p>

          <button
            onClick={() => navigate('/plan-history')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-sm transition-all border border-white/20 font-medium"
          >
            <History className="h-5 w-5" />
            View Plan History
          </button>
        </div>
      </div>

      <div className="max-w-[95rem] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Current Usage & Limits Section */}
        {usageCards.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-3xl -mx-4 sm:mx-0 p-4 sm:p-8 shadow-xl border-y sm:border dark:border-slate-700 animate-fadeIn">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                <Zap className="h-6 w-6 text-[#2F3C7E] dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Current Usage & Limits</h2>
                <p className="text-gray-500 dark:text-slate-400">Your aggregated limits across all valid plans</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {usageCards.map((card) => {
                const info = card.summary;
                if (!info) return null;

                const used = formatUsedValue(info);
                const limit = formatLimitValue(info);
                const isUnlimited = info.isUnlimited;
                const percentage = isUnlimited
                  ? (used > 0 ? 5 : 0) // Show small progress for unlimited
                  : (typeof info.limit === 'number' && info.limit > 0)
                    ? Math.min(100, (used / info.limit) * 100)
                    : (used > 0 ? 100 : 0); // If limit is 0 but used > 0, show 100% (over limit)

                return (
                  <div key={card.key} className="p-6 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700 hover:shadow-md transition-all duration-300">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-gray-700 dark:text-gray-300">{card.label}</h3>
                      <div className={`p-2 rounded-lg ${card.key === 'customers' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                        card.key === 'products' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' :
                          'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                        }`}>
                        {card.key === 'customers' ? <Users size={20} /> :
                          card.key === 'products' ? <Package size={20} /> :
                            <Check size={20} />}
                      </div>
                    </div>

                    <div className="mb-3 flex items-baseline justify-between">
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">{used}</span>
                      <span className="text-gray-500 dark:text-gray-400 font-medium">
                        / {limit}
                      </span>
                    </div>

                    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${isUnlimited ? 'bg-gradient-to-r from-blue-400 to-purple-500' :
                          percentage > 90 ? 'bg-red-500' :
                            percentage > 75 ? 'bg-orange-500' :
                              'bg-[#2F3C7E] dark:bg-blue-500'
                          }`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>

                    <div className="mt-2 text-xs text-right text-gray-400 dark:text-slate-500">
                      {isUnlimited ? 'Unlimited Access' : `${Math.round(percentage)}% Used`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* All Plans Section */}
        <div className="space-y-8">
          {/* Category Tabs */}
          <div className="flex flex-wrap justify-center gap-2 sm:gap-4 p-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border dark:border-slate-700 max-w-2xl mx-auto">
            {[
              { id: 'free', label: 'Free Plans', icon: <Package className="h-4 w-4" /> },
              { id: 'standard', label: 'Standard Plans', icon: <Star className="h-4 w-4" /> },
              { id: 'pro', label: 'Pro Plans', icon: <Crown className="h-4 w-4" /> },
              { id: 'mini', label: 'Mini Plans', icon: <Zap className="h-4 w-4" /> }
            ].map(cat => {
              const hasPlans = plans.some(p => p.planType === cat.id);
              if (!hasPlans && cat.id !== activeCategory) return null;

              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all duration-300 ${activeCategory === cat.id
                    ? 'bg-[#2F3C7E] text-white shadow-lg scale-105'
                    : 'bg-transparent text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 dark:text-slate-400'
                    }`}
                >
                  {cat.icon}
                  <span className="text-sm">{cat.label}</span>
                </button>
              );
            })}
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 capitalize">
              {activeCategory} Plans
            </h2>
            <p className="text-gray-600 dark:text-slate-400">Select a plan to view details and upgrade</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans
              .filter(p => p.planType === activeCategory)
              .map((plan) => {
                const isCurrent = plan.current;
                const isPopular = plan.popular;
                const isBestValue = plan.bestValue;
                const planPrice = plan?.rawPrice || parseFloat(String(plan?.price).replace(/[^0-9.]/g, '') || '0');
                const discount = plan.fakePrice > planPrice
                  ? Math.round(((plan.fakePrice - planPrice) / plan.fakePrice) * 100)
                  : 0;

                return (
                  <button
                    key={plan.id || plan._id}
                    onClick={() => setCheckoutPlan(plan)}
                    className={`relative p-8 rounded-[2rem] transition-all duration-300 text-left group border flex flex-col justify-between overflow-hidden min-h-[220px]
                      ${isCurrent
                        ? 'bg-green-50/50 border-black dark:border-white ring-4 ring-green-500/20 dark:bg-green-900/10'
                        : isPopular
                          ? 'bg-gradient-to-br from-orange-50/50 to-white border-black dark:border-white hover:border-black ring-2 ring-orange-100 dark:from-orange-900/10 dark:to-slate-800'
                          : isBestValue
                            ? 'bg-gradient-to-br from-blue-50/50 to-white border-black dark:border-white hover:border-black ring-2 ring-blue-100 dark:from-blue-900/10 dark:to-slate-800'
                            : 'bg-white border-black dark:border-white hover:border-black dark:bg-slate-800'
                      }
                      hover:shadow-2xl hover:-translate-y-2 active:scale-95
                    `}
                  >
                    {/* Floating Badges */}
                    <div className="absolute top-0 right-0 p-4 flex flex-col items-end gap-2 z-10">
                      {isCurrent && <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">ACTIVE</span>}
                      {isPopular && !isCurrent && <span className="bg-[#F4A259] text-white text-xs font-bold px-3 py-1 rounded-full shadow-md flex items-center gap-1"><Star className="h-3 w-3 fill-current" /> POPULAR</span>}
                      {isBestValue && !isCurrent && <span className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md flex items-center gap-1"><Zap className="h-3 w-3 fill-current" /> BEST</span>}
                      {discount > 0 && <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">{discount}% OFF</span>}
                    </div>

                    {/* Duration Badge (Top Left) */}
                    <div className="absolute top-0 left-0 p-4 z-10">
                      <span className="bg-gray-100/80 dark:bg-slate-700/80 backdrop-blur-sm text-gray-700 dark:text-slate-200 text-xs font-black px-3 py-1.5 rounded-xl border border-gray-200 dark:border-slate-600 shadow-sm capitalize tracking-wider">
                        {plan.period?.replace(/per\s*/i, '').trim()}
                      </span>
                    </div>

                    <div className="mb-6 mt-8 pr-10 relative z-0">
                      <h3 className="font-bold text-gray-800 dark:text-gray-100 text-xl leading-tight line-clamp-2">{plan.name}</h3>
                    </div>

                    {/* Limits Section */}
                    <div className="mb-6 space-y-2 p-4 bg-gray-50 dark:bg-slate-700/30 rounded-2xl border border-gray-100 dark:border-slate-700/50">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-slate-400 flex items-center gap-2"><Users className="h-4 w-4" /> Customers:</span>
                        <span className="font-bold text-gray-800 dark:text-slate-200 text-base">{plan.maxCustomers === -1 || plan.maxCustomers === Infinity ? 'Unlimited' : plan.maxCustomers}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-slate-400 flex items-center gap-2"><Package className="h-4 w-4" /> Products:</span>
                        <span className="font-bold text-gray-800 dark:text-slate-200 text-base">{plan.maxProducts === -1 || plan.maxProducts === Infinity ? 'Unlimited' : plan.maxProducts}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-slate-400 flex items-center gap-2"><Check className="h-4 w-4" /> Orders:</span>
                        <span className="font-bold text-gray-800 dark:text-slate-200 text-base">{plan.maxOrders === -1 || plan.maxOrders === Infinity ? 'Unlimited' : plan.maxOrders}</span>
                      </div>
                    </div>

                    <div className="mt-auto space-y-1 relative z-0">
                      {plan.fakePrice > planPrice ? (
                        <div className="flex flex-col">
                          <div className="relative w-fit">
                            <span className="text-6xl font-black text-red-500/80 -ml-1">
                              {formatCurrencySmart(plan.fakePrice, state.currencyFormat)}
                            </span>
                            <div className="absolute top-1/2 left-0 h-[4px] bg-black dark:bg-white rounded-full -translate-y-1/2" style={{ animation: 'strikeAnimation 2.5s ease-in-out infinite' }}></div>
                          </div>
                          <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-4xl font-black text-gray-900 dark:text-white">
                              {formatCurrencySmart(planPrice, state.currencyFormat)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-black text-gray-900 dark:text-white">
                            {formatCurrencySmart(planPrice, state.currencyFormat)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* View Option (Bottom Right) */}
                    <div className="absolute bottom-4 right-4 z-10">
                      <span className="text-sm font-bold text-[#2F3C7E] dark:text-blue-400 group-hover:underline flex items-center gap-1">
                        View details <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>

          {plans.filter(p => p.planType === activeCategory).length === 0 && (
            <div className="text-center py-12 bg-gray-50 dark:bg-slate-800/50 rounded-3xl border-2 border-dashed dark:border-slate-700">
              <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-slate-400">No {activeCategory} plans available at the moment.</p>
            </div>
          )}
        </div>
      </div >

      {/* Premium Checkout Modal */}
      {/* Balanced Premium Checkout Modal */}
      {
        checkoutPlan && (

          <div
            className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center sm:p-6 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
            onClick={handleCloseCheckout}
          >
            <div
              key={isClosing ? 'closing' : 'opening'}
              style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
              className="bg-white dark:bg-slate-800 w-full sm:max-w-2xl h-auto max-h-[95vh] sm:h-auto sm:max-h-[90vh] rounded-t-none sm:rounded-[2rem] shadow-2xl flex flex-col relative overflow-hidden dark:border dark:border-slate-700"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-[#2F3C7E] to-[#3d4a8f] dark:from-slate-700 dark:to-slate-800 p-8 text-white relative">
                <button
                  onClick={handleCloseCheckout}
                  className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <X className="h-6 w-6" />
                </button>
                <h3 className="text-3xl font-bold mb-2">{checkoutPlan.name}</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black">{formatCurrencySmart(checkoutPlan.rawPrice || checkoutPlan.price || 0, state.currencyFormat)}</span>
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
                {checkoutPlan.planType !== 'mini' && (
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
                )}
              </div>

              <div className="p-4 border-t dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 backdrop-blur-sm">
                <button
                  onClick={(e) => handlePlanSelect(checkoutPlan.id || checkoutPlan._id, e)}
                  disabled={upgradingPlanId}
                  type="button"
                  className="w-full py-4 bg-[#2F3C7E] dark:bg-blue-600 text-white rounded-2xl font-bold shadow-lg hover:bg-[#3d4a8f] dark:hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                >
                  {upgradingPlanId ? (
                    <Loader className="animate-spin h-5 w-5" />
                  ) : (
                    <>
                      <span>
                        {(() => {
                          if (checkoutPlan.planType === 'mini') return 'Top-Up';
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
                <div className="mt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-gray-400 dark:text-slate-500">
                    <Shield className="h-4 w-4" />
                    <span className="text-xs font-medium">Secure Payment via Razorpay</span>
                  </div>

                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};

export default Upgrade;
