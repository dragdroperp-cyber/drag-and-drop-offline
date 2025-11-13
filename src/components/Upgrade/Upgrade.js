import React, { useState, useEffect } from 'react';
import { useApp, ActionTypes, mergePlanDetailsWithUsage } from '../../context/AppContext';
import { Crown, Check, Star, Zap, Shield, Users, Lock, Unlock } from 'lucide-react';
import { apiRequest } from '../../utils/api';

const Upgrade = () => {
  const { state, dispatch } = useApp();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sellerPlanInfo, setSellerPlanInfo] = useState(null);
  const [activePlanOrdersCount, setActivePlanOrdersCount] = useState(0);
  const [upgradingPlanId, setUpgradingPlanId] = useState(null);

  const planUsageSummary = state.currentPlanDetails?.planUsageSummary;
  const usageCards = planUsageSummary
    ? [
        { key: 'customers', label: 'Customers', summary: planUsageSummary.customers },
        { key: 'products', label: 'Products', summary: planUsageSummary.products },
        { key: 'orders', label: 'Orders', summary: planUsageSummary.orders }
      ].filter(card => card.summary)
    : [];

  const formatUsedValue = (info) => (typeof info?.used === 'number' ? info.used : 0);
  const formatLimitValue = (info) => (info?.isUnlimited ? 'Unlimited' : (typeof info?.limit === 'number' ? info.limit : 0));
  const formatRemainingValue = (info) => {
    if (!info) return 0;
    if (info.isUnlimited) return 'Unlimited';
    if (typeof info.remaining === 'number') {
      return Math.max(0, info.remaining);
    }
    if (typeof info.limit === 'number') {
      return Math.max(0, info.limit - formatUsedValue(info));
    }
    return Math.max(0, -formatUsedValue(info));
  };

  // Extract fetchPlans as a separate function so we can call it after upgrade
  const fetchPlans = async () => {
    try {
      setError(null);
      const result = await apiRequest('/data/plans');

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
            // Use backend's isCurrentPlan flag, or fallback to local check
            current: plan.isCurrentPlan !== undefined 
              ? plan.isCurrentPlan
              : (state.currentPlan === plan.id || 
                 state.currentPlan === plan.name?.toLowerCase()?.replace(/\s+/g, '-') ||
                 state.currentPlan === plan._id)
          }));
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

  // Helper function to refresh plan details
  const refreshPlanDetails = async () => {
    try {
      const [planResult, usageResult] = await Promise.all([
        apiRequest('/data/current-plan'),
        apiRequest('/plans/usage')
      ]);

      const planPayload = planResult.success && planResult.data
        ? (Array.isArray(planResult.data) ? planResult.data : planResult.data.data || planResult.data)
        : null;

      const usagePayload = usageResult.success && usageResult.data && usageResult.data.summary
        ? usageResult.data
        : null;

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
      console.error('Error refreshing plan details:', planError);
    }
  };

  const handlePlanSelect = async (planId) => {
    const selectedPlan = plans.find(p => p.id === planId || p._id === planId);
    
    // If this is already the current plan, do nothing
    if (selectedPlan?.current) {
      return;
    }

    // If user already has this plan (valid, non-expired), just switch to it
    if (selectedPlan?.userHasThisPlan) {
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
    
    // If plan is free, upgrade directly
    if (planPrice === 0) {
      try {
        setUpgradingPlanId(planId);
        const result = await apiRequest('/data/plans/upgrade', {
          method: 'POST',
          body: { planId }
        });

        if (result.success) {
          const resultData = result.data?.data || result.data;
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
          window.showToast(`Successfully upgraded to ${resultData?.planName || selectedPlan?.name || 'selected plan'}!`, 'success');
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
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
          window.showToast(`Successfully upgraded to ${upgradeData?.planName || selectedPlan?.name || 'selected plan'}!`, 'success');
          await fetchPlans();
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
              dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planId });
              window.showToast(`Successfully upgraded to ${verifyData?.planName || selectedPlan?.name || 'selected plan'}!`, 'success');
              await fetchPlans();
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

  const currentPlan = plans.find(p => p.current) || plans[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className="p-4 bg-gradient-to-r from-black to-primary-500 rounded-full">
            <Crown className="h-12 w-12 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Plan</h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Unlock the full potential of your grocery business with our advanced features and tools.
        </p>
        
        {/* Upgrade Instructions */}
        <div className="mt-6 p-4 bg-primary-50 border border-primary-200 rounded-lg max-w-2xl mx-auto">
          <div className="flex items-center justify-center text-primary-800">
            <Crown className="h-5 w-5 mr-2" />
            <span className="font-medium">How to Upgrade:</span>
          </div>
          <p className="text-primary-700 text-sm mt-2">
            Simply click on any plan card below to instantly upgrade your account. 
            All features will be unlocked immediately!
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

      {/* Current Subscription Status */}
      <div className="bg-gradient-to-r from-black to-primary-500 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2">Current Plan: {currentPlan?.name || 'Basic'}</h2>
            <p className="text-white/80">{currentPlan?.description || ''}</p>
            {sellerPlanInfo && sellerPlanInfo.expiryDate && (
              <p className="text-white/80 text-sm mt-2">
                Expires: {new Date(sellerPlanInfo.expiryDate).toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
                {sellerPlanInfo.isExpired && (
                  <span className="ml-2 bg-red-500 px-2 py-1 rounded text-xs">Expired</span>
                )}
              </p>
            )}
            <p className="text-white/80 text-sm mt-2">
              💡 Click any plan below to upgrade instantly!
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">{currentPlan?.price || '₹299'}</p>
            <p className="text-green-100">{currentPlan?.period || 'per month'}</p>
          </div>
        </div>
      </div>

      {(usageCards.length > 0 || activePlanOrdersCount > 0) && (
        <div className="bg-white rounded-xl p-6 shadow-sm mb-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Active Plan Capacity</h2>
              {activePlanOrdersCount > 0 && (
                <p className="text-sm text-gray-600 mt-1">
                  You have {activePlanOrdersCount} active plan order{activePlanOrdersCount === 1 ? '' : 's'} in use.
                </p>
              )}
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

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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

            {!plan.current && plan.userHasThisPlan && (
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
                    <span className="font-medium">{plan.maxCustomers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Products:</span>
                    <span className="font-medium">{plan.maxProducts}</span>
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

              <button
                onClick={() => handlePlanSelect(plan.id || plan._id)}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-200 ${
                  plan.current
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : upgradingPlanId === (plan.id || plan._id)
                    ? 'bg-gray-400 text-white cursor-wait'
                    : 'bg-primary-500 hover:bg-primary-600 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-1'
                }`}
                disabled={plan.current || upgradingPlanId === (plan.id || plan._id)}
              >
                {plan.current 
                  ? 'Current Plan' 
                  : upgradingPlanId === (plan.id || plan._id)
                  ? (plan.userHasThisPlan ? 'Switching...' : 'Upgrading...')
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



