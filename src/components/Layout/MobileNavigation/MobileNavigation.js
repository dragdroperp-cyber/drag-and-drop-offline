import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../../context/AppContext';
import { 
  LayoutDashboard, 
  Users, 
  Receipt, 
  Package, 
  Warehouse,
  Truck,
  DollarSign,
  BarChart3,
  Crown
} from 'lucide-react';
import { isModuleUnlocked, getUpgradeMessage } from '../../../utils/planUtils';
import { getPathForView } from '../../../utils/navigation';

const MobileNavigation = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  
  const navigation = [
    { name: 'Dashboard', href: 'dashboard', icon: LayoutDashboard },
    { name: 'Customers', href: 'customers', icon: Users },
    { name: 'Products', href: 'products', icon: Package },
    { name: 'Inventory', href: 'inventory', icon: Warehouse },
    { name: 'Billing', href: 'billing', icon: Receipt },
    { name: 'Purchase', href: 'purchase', icon: Truck },
    { name: 'Financial', href: 'financial', icon: DollarSign },
    { name: 'Reports', href: 'reports', icon: BarChart3 },
    { name: 'Upgrade', href: 'upgrade', icon: Crown },
  ];

  const handleNavigation = (view) => {
    // Dashboard is always accessible for all users
    if (view !== 'dashboard' && !isModuleUnlocked(view, state.currentPlan, state.currentPlanDetails)) {
      if (window.showToast) window.showToast(getUpgradeMessage(view, state.currentPlan), 'warning');
      return;
    }
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(getPathForView(view));
  };

  return (
    <div className="hidden sm:block lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
      <div className="flex justify-around py-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = state.currentView === item.href;
          const isUpgrade = item.href === 'upgrade';
          const isUnlocked = item.href === 'dashboard' || isUpgrade
            ? true
            : isModuleUnlocked(item.href, state.currentPlan, state.currentPlanDetails);
          return (
            <button
              key={item.name}
              onClick={() => handleNavigation(item.href)}
              className={`flex flex-col items-center p-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'text-green-600'
                  : isUnlocked ? 'text-gray-500 hover:text-gray-700' : 'text-gray-400'
              }`}
              disabled={!isUnlocked}
            >
              <Icon className="h-5 w-5 mb-1" />
              <span className="truncate">{item.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MobileNavigation;
