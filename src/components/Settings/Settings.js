import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useApp, ActionTypes } from '../../context/AppContext';
import {
  Save,
  Bell,
  AlertTriangle,
  RefreshCw,
  LogOut,
  X,
  WifiOff,
  Store,
  CreditCard,
  User,
  MapPin,
  Phone,
  Mail,
  Building2,
  Edit,
  Shield,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { apiRequest } from '../../utils/api';
import { STORES, addItem, updateItem, getItem } from '../../utils/indexedDB';

// Staff Settings Component
const StaffSettings = () => {
  const { state, dispatch } = useApp();

  // Debug logging - only once when component mounts
  useEffect(() => {
    console.log('StaffSettings component rendered');
    // Check if resign button exists after render
    setTimeout(() => {
      const resignBtn = document.querySelector('button');
      console.log('Resign button element found:', resignBtn);
      if (resignBtn) {
        console.log('Button text:', resignBtn.textContent);
        console.log('Button classes:', resignBtn.className);
      }
    }, 100);
  }, []);
  const [loading, setLoading] = useState(false);
  const [sellerInfo, setSellerInfo] = useState(null);
  const [showResignModal, setShowResignModal] = useState(false);
  const [resignationReason, setResignationReason] = useState('');
  const [isResigning, setIsResigning] = useState(false);

  // Get seller name from various possible sources
  const getStoreName = () => {
    // Try different sources for seller data
    const sellerData = state.currentUser?.seller || sellerInfo || state.seller || state.currentUser?.sellerId;
    return sellerData?.shopName || sellerData?.name || 'Store Information';
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      // Dispatch logout action (clears IndexedDB, localStorage, stops sync)
      dispatch({ type: ActionTypes.LOGOUT });

      // Sign out from Firebase
      await signOut(auth);

      // Show success message
      if (window.showToast) {
        window.showToast('Logged out successfully', 'success');
      }

      // Navigate to login
      setTimeout(() => {
        window.location.href = '/login';
      }, 1000);
    } catch (error) {
      console.error('Error logging out:', error);
      if (window.showToast) {
        window.showToast('Error logging out', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch seller info if not available in currentUser
  useEffect(() => {
    const fetchSellerInfo = async () => {
      if (state.currentUser?.sellerId && !state.currentUser?.seller && !sellerInfo) {
        try {
          console.log('🔄 Fetching seller info for staff user...');
          const response = await apiRequest('/data/seller/profile');
          if (response.success && response.data?.seller) {
            console.log('✅ Fetched seller info:', response.data.seller);
            setSellerInfo(response.data.seller);
          }
        } catch (error) {
          console.error('❌ Failed to fetch seller info:', error);
        }
      }
    };

    fetchSellerInfo();
  }, [state.currentUser?.sellerId, state.currentUser?.seller, sellerInfo]);

  const handleResign = async () => {
    if (!resignationReason.trim()) {
      if (window.showToast) {
        window.showToast('Please provide a reason for resignation', 'warning');
      }
      return;
    }

    setIsResigning(true);
    try {
      const response = await apiRequest(`/staff/${state.currentUser._id}/resign`, {
        method: 'PATCH',
        body: {
          reason: resignationReason.trim()
        }
      });

      if (response.success) {
        if (window.showToast) {
          window.showToast('You have successfully resigned. Your account has been deactivated.', 'success');
        }
        // Logout immediately
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      } else {
        if (window.showToast) {
          window.showToast(response.message || 'Failed to process resignation', 'error');
        }
      }
    } catch (error) {
      console.error('Resignation error:', error);
      if (window.showToast) {
        window.showToast('Failed to process resignation', 'error');
      }
    } finally {
      setIsResigning(false);
      setShowResignModal(false);
      setResignationReason('');
    }
  };

  // Resignation Modal
  return showResignModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Confirm Resignation</h3>
          <button
            onClick={() => {
              if (!isResigning) {
                setShowResignModal(false);
                setResignationReason('');
              }
            }}
            className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            disabled={isResigning}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-gray-600 text-sm mb-4">
            Are you sure you want to resign from your staff position? This action cannot be undone and will:
          </p>
          <ul className="text-sm text-gray-600 space-y-1 mb-4">
            <li>• Immediately deactivate your account</li>
            <li>• Revoke all your permissions</li>
            <li>• Remove access from all devices</li>
            <li>• Notify your seller about your resignation</li>
          </ul>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Reason for resignation (optional)
          </label>
          <textarea
            value={resignationReason}
            onChange={(e) => setResignationReason(e.target.value)}
            placeholder="Please provide a reason for your resignation..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
            rows={3}
            disabled={isResigning}
            maxLength={500}
          />
          <p className="text-xs text-gray-500 mt-1">
            {resignationReason.length}/500 characters
          </p>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={() => {
              if (!isResigning) {
                setShowResignModal(false);
                setResignationReason('');
              }
            }}
            className="flex-1 btn-secondary"
            disabled={isResigning}
          >
            Cancel
          </button>
          <button
            onClick={handleResign}
            disabled={isResigning}
            className="flex-1 btn-primary bg-red-600 hover:bg-red-700 disabled:bg-red-400"
          >
            {isResigning ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Confirm Resignation'
            )}
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-white/20 backdrop-blur-sm p-3 rounded-xl">
                <User className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Staff Settings</h1>
                <p className="text-indigo-100 mt-1">Manage your account settings and preferences</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Settings Content */}
        <div className="space-y-8">
          {/* Profile Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2 text-indigo-600" />
              Profile Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={state.currentUser?.name || ''}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={state.currentUser?.email || ''}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>
            </div>
          </div>

          {/* Permissions Section */}
          {state.currentUser?.permissions && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Shield className="h-5 w-5 mr-2 text-green-600" />
                Your Permissions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(state.currentUser.permissions).map(([key, value]) => (
                  <div
                    key={key}
                    className={`p-4 rounded-lg border ${
                      value
                        ? 'bg-green-50 border-green-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${
                        value ? 'bg-green-500' : 'bg-gray-400'
                      }`}></div>
                      <div>
                        <p className="font-medium text-sm text-gray-900 capitalize">
                          {key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                        <p className={`text-xs ${
                          value ? 'text-green-600' : 'text-gray-500'
                        }`}>
                          {value ? 'Enabled' : 'Disabled'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">Permission Changes</p>
                    <p className="text-sm text-blue-700 mt-1">
                      If you need additional permissions or believe your current permissions are incorrect,
                      please contact your seller directly.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Seller Information Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Building2 className="h-5 w-5 mr-2 text-blue-600" />
              Your Workplace
            </h3>
            <div className="flex items-center space-x-4">
              <div className="bg-blue-100 rounded-full p-3">
                <Building2 className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h4 className="font-semibold text-gray-900">{getStoreName()}</h4>
                <p className="text-gray-600 text-sm">Your current workplace</p>
              </div>
            </div>
          </div>

          {/* Logout Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Sign Out</h3>
                <p className="text-gray-600 text-sm">Sign out of your staff account and return to login</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={loading}
                className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-xl font-semibold flex items-center space-x-2 transition-colors"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Signing out...</span>
                  </>
                ) : (
                  <>
                    <LogOut className="h-5 w-5" />
                    <span>Sign Out</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Resignation Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-red-900 mb-1">Resign from Position</h3>
                <p className="text-red-600 text-sm">Permanently leave your staff position. This action cannot be undone.</p>
              </div>
              <button
                onClick={() => setShowResignModal(true)}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-semibold flex items-center space-x-2 transition-colors"
              >
                <AlertCircle className="h-5 w-5" />
                <span>Resign</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-white/20 backdrop-blur-sm p-3 rounded-xl">
                <User className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Staff Settings</h1>
                <p className="text-indigo-100 mt-1">Manage your account settings and preferences</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="h-5 w-5 mr-2 text-indigo-600" />
            Profile Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
              <input
                type="text"
                value={state.currentUser?.name || ''}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={state.currentUser?.email || ''}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
              />
            </div>
          </div>
        </div>

        {/* Permissions Section */}
        {state.currentUser?.permissions && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-green-600" />
              Your Permissions
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(state.currentUser.permissions).map(([key, value]) => (
                <div
                  key={key}
                  className={`p-4 rounded-lg border ${
                    value
                      ? 'bg-green-50 border-green-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      value ? 'bg-green-500' : 'bg-gray-400'
                    }`}></div>
                    <div>
                      <p className="font-medium text-sm text-gray-900 capitalize">
                        {key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}
                      </p>
                      <p className={`text-xs ${
                        value ? 'text-green-600' : 'text-gray-500'
                      }`}>
                        {value ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900">Permission Changes</p>
                  <p className="text-sm text-blue-700 mt-1">
                    If you need additional permissions or believe your current permissions are incorrect,
                    please contact your seller directly.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Resignation Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-red-900 mb-1">Resign from Position</h3>
              <p className="text-red-600 text-sm">Permanently leave your staff position. This action cannot be undone.</p>
            </div>
            <button
              onClick={() => setShowResignModal(true)}
              className="bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-xl font-bold text-lg flex items-center space-x-2 transition-colors border-4 border-yellow-400"
            >
              <AlertCircle className="h-5 w-5" />
              <span>🚨 RESIGN 🚨</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main Settings Component
const Settings = memo(() => {
  const { state } = useApp();
  const isStaffUser = state.userType === 'staff' || state.currentUser?.userType === 'staff';

  // Debug logging - only when values change
  useEffect(() => {
    console.log('Settings component - state.userType:', state.userType);
    console.log('Settings component - state.currentUser?.userType:', state.currentUser?.userType);
    console.log('Settings component - isStaffUser:', isStaffUser);
  }, [state.userType, state.currentUser?.userType, isStaffUser]);

  // If user is staff, show staff settings
  if (isStaffUser) {
    return <StaffSettings />;
  }

  // Original seller settings component
  return <SellerSettings />;
});

// Seller Settings Component (original Settings functionality)
const SellerSettings = () => {
  const { state, dispatch } = useApp();
  const isStaffUser = state.userType === 'staff' || state.currentUser?.userType === 'staff'; // This will always be false for sellers

  const getSellerId = (currentUser) => {
    if (currentUser?._id) return currentUser._id;
    if (currentUser?.sellerId) return currentUser.sellerId;
    try {
      const authData = JSON.parse(localStorage.getItem('auth') || '{}');
      return authData.sellerId || authData.currentUser?._id || authData.currentUser?.sellerId || null;
    } catch (error) {
      console.error('Error reading sellerId from storage:', error);
      return null;
    }
  };

  const mapUserToSettings = (user) => {
  // Prioritize businessType, fallback to businessCategory, then default to 'Retail'
  // But only use 'Retail' if both are truly undefined/null/empty
  const businessTypeValue = user?.businessType || user?.businessCategory;
  const finalBusinessType = (businessTypeValue && businessTypeValue.trim() !== '') 
    ? businessTypeValue.trim() 
    : 'Retail';
  
  return {
    lowStockThreshold: user?.lowStockThreshold ?? 10,
    expiryDaysThreshold: user?.expiryDaysThreshold ?? 7,
    storeName: user?.shopName || '',
    gstNumber: user?.gstNumber || '',
    upiId: user?.upiId || '',
    sellerName: user?.name || '',
    sellerEmail: user?.email || '',
    sellerPhone: user?.phoneNumber || user?.mobileNumber || '',
    businessAddress: user?.shopAddress || user?.address || '',
    businessCity: user?.city || '',
    businessState: user?.state || '',
    businessPincode: user?.pincode || '',
    businessType: finalBusinessType
  };
};

const buildSettingsRecord = (sellerId, settings, overrides = {}) => ({
  id: `settings_${sellerId}`,
  sellerId,
  ...settings,
  updatedAt: new Date().toISOString(),
  isSynced: false,
  ...overrides
});

const convertRecordToSettingsState = (record, fallbackEmail = '') => {
  // Prioritize businessType, fallback to businessCategory, then default to 'Retail'
  // But only use 'Retail' if both are truly undefined/null/empty
  const businessTypeValue = record?.businessType || record?.businessCategory;
  const finalBusinessType = (businessTypeValue && businessTypeValue.trim() !== '') 
    ? businessTypeValue.trim() 
    : 'Retail';
  
  return {
    lowStockThreshold: record?.lowStockThreshold ?? 10,
    expiryDaysThreshold: record?.expiryDaysThreshold ?? 7,
    storeName: record?.storeName || '',
    gstNumber: record?.gstNumber || '',
    upiId: record?.upiId || '',
    sellerName: record?.sellerName || '',
    sellerEmail: record?.sellerEmail || fallbackEmail,
    sellerPhone: record?.sellerPhone || '',
    businessAddress: record?.businessAddress || '',
    businessCity: record?.businessCity || '',
    businessState: record?.businessState || '',
    businessPincode: record?.businessPincode || '',
    businessType: finalBusinessType
  };
};

// Helper function to compare two settings objects
const areSettingsDifferent = (settings1, settings2) => {
  if (!settings1 || !settings2) return true;
  
  const keys = [
    'lowStockThreshold',
    'expiryDaysThreshold',
    'storeName',
    'gstNumber',
    'upiId',
    'sellerName',
    'sellerEmail',
    'sellerPhone',
    'businessAddress',
    'businessCity',
    'businessState',
    'businessPincode',
    'businessType'
  ];
  
  for (const key of keys) {
    const val1 = String(settings1[key] || '').trim();
    const val2 = String(settings2[key] || '').trim();
    if (val1 !== val2) {
      return true;
    }
  }
  
  return false;
};

const buildRequestBody = (settings) => ({
  upiId: settings.upiId.trim(),
  username: settings.sellerName,
  phone: settings.sellerPhone,
  address: settings.businessAddress,
  city: settings.businessCity,
  state: settings.businessState,
  pincode: settings.businessPincode,
  businessType: settings.businessType,
  storeName: settings.storeName,
  gstNumber: settings.gstNumber,
  lowStockThreshold: parseInt(settings.lowStockThreshold, 10) || 0,
  expiryDaysThreshold: parseInt(settings.expiryDaysThreshold, 10) || 0
});

const saveSettingsToIndexedDB = async (record) => {
  try {
    await updateItem(STORES.settings, record, true);
  } catch (error) {
    try {
      await addItem(STORES.settings, record, true);
    } catch (addError) {
      console.error('Error saving settings to IndexedDB:', addError);
    }
  }
};
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const [settings, setSettings] = useState({
    lowStockThreshold: 10,
    expiryDaysThreshold: 7,
    storeName: '',
    gstNumber: '',
    upiId: '',
    sellerName: '',
    sellerEmail: '',
    sellerPhone: '',
    businessAddress: '',
    businessCity: '',
    businessState: '',
    businessPincode: '',
    businessType: 'Retail'
  });
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isProcessingLogout, setIsProcessingLogout] = useState(false);
  const [logoutUnsyncedSummary, setLogoutUnsyncedSummary] = useState([]);
  const [logoutFeedback, setLogoutFeedback] = useState({ message: '', offline: false });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const sellerId = getSellerId(state.currentUser);
  const currentUserEmail = state.currentUser?.email || '';
  
  // Refs to prevent duplicate API calls
  const hasLoadedRef = useRef(false);
  const isFetchingRef = useRef(false);

  const ensureSettingsRecord = useCallback(async () => {
    if (!sellerId) return null;
    try {
      return await getItem(STORES.settings, `settings_${sellerId}`);
    } catch (error) {
      if (error?.name === 'NotFoundError') {
        // Use currentUserEmail from closure, don't depend on state.currentUser object
        const fallbackSettings = mapUserToSettings(state.currentUser || { email: currentUserEmail });
        const initialRecord = buildSettingsRecord(sellerId, fallbackSettings, {
          isSynced: true,
          sellerEmail: fallbackSettings.sellerEmail || currentUserEmail
        });
        await saveSettingsToIndexedDB(initialRecord);
        return initialRecord;
      }
      throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId, currentUserEmail]);

  const syncSettingsToMongoDB = useCallback(async ({ silent = false } = {}) => {
    if (!sellerId) {
      return true;
    }
    if (!isOnline) {
      return false;
    }
    try {
      const record = await ensureSettingsRecord();
      if (!record || record.isSynced) {
        setHasUnsyncedChanges(false);
        return true;
      }

      const requestBody = buildRequestBody(record);
      console.log('🌐 Syncing offline settings to MongoDB:', requestBody);

      const response = await apiRequest('/data/seller/settings', {
        method: 'PUT',
        body: requestBody
      });

      if (response.success) {
        // Fetch fresh seller data from backend after successful sync
        try {
          const profileResponse = await apiRequest('/data/seller/profile');
          // Handle nested response structure from apiRequest wrapper
          const sellerData = profileResponse.data?.data?.seller || profileResponse.data?.seller;
          
          if (profileResponse.success && sellerData) {
            const backendSettings = mapUserToSettings(sellerData);
            setSettings(backendSettings);
            
            // Update currentUser in context with fresh data
            dispatch({ type: ActionTypes.UPDATE_USER, payload: sellerData });
            
            // Save to IndexedDB as synced with fresh data
            const syncedRecord = buildSettingsRecord(sellerId, backendSettings, {
              updatedAt: new Date().toISOString(),
              isSynced: true,
              syncedAt: new Date().toISOString(),
              sellerEmail: backendSettings.sellerEmail
            });
            await saveSettingsToIndexedDB(syncedRecord);
            
            // Update localStorage
            try {
              const authData = JSON.parse(localStorage.getItem('auth') || '{}');
              authData.currentUser = sellerData;
              localStorage.setItem('auth', JSON.stringify(authData));
            } catch (error) {
              console.error('Error updating auth storage after sync:', error);
            }
          } else {
            // Fallback to updating from record if profile fetch fails
            const fallbackEmail = record.sellerEmail || currentUserEmail;
            const syncedRecord = buildSettingsRecord(sellerId, convertRecordToSettingsState(record, fallbackEmail), {
              updatedAt: new Date().toISOString(),
              isSynced: true,
              syncedAt: new Date().toISOString(),
              sellerEmail: fallbackEmail
            });
            await saveSettingsToIndexedDB(syncedRecord);
            
            if (state.currentUser) {
              const updatedUser = {
                ...state.currentUser,
                name: record.sellerName,
                phoneNumber: record.sellerPhone,
                shopName: record.storeName,
                shopAddress: record.businessAddress,
                city: record.businessCity,
                state: record.businessState,
                pincode: record.businessPincode,
                gstNumber: record.gstNumber,
                businessType: record.businessType || record.businessCategory,
                upiId: record.upiId,
                lowStockThreshold: record.lowStockThreshold,
                expiryDaysThreshold: record.expiryDaysThreshold
              };
              dispatch({ type: ActionTypes.UPDATE_USER, payload: updatedUser });
            }
          }
        } catch (profileError) {
          console.error('Error fetching seller profile after sync:', profileError);
          // Still mark as synced even if profile fetch fails
          const fallbackEmail = record.sellerEmail || currentUserEmail;
          const syncedRecord = buildSettingsRecord(sellerId, convertRecordToSettingsState(record, fallbackEmail), {
            updatedAt: new Date().toISOString(),
            isSynced: true,
            syncedAt: new Date().toISOString(),
            sellerEmail: fallbackEmail
          });
          await saveSettingsToIndexedDB(syncedRecord);
        }
        
        setHasUnsyncedChanges(false);

        if (!silent && window.showToast) {
          window.showToast('Offline changes synced successfully!', 'success');
        }
        return true;
      } else {
        setHasUnsyncedChanges(true);
        if (!silent && window.showToast) {
          window.showToast(response.error || 'Failed to sync settings. Will retry automatically.', 'warning');
        }
        return false;
      }
    } catch (error) {
      console.error('Error syncing settings to MongoDB:', error);
      setHasUnsyncedChanges(true);
      if (!silent && window.showToast) {
        window.showToast('Failed to sync settings. They will retry automatically.', 'error');
      }
      return false;
    }
  }, [sellerId, isOnline, currentUserEmail, state.currentUser, dispatch, ensureSettingsRecord]);

  // Load settings: Show IndexedDB data first, then update if API data is different
  useEffect(() => {
    if (!sellerId) {
      hasLoadedRef.current = false;
      isFetchingRef.current = false;
      return;
    }
    
    // Reset refs when sellerId changes (new seller logged in)
    hasLoadedRef.current = false;
    isFetchingRef.current = false;
    
    let isMounted = true;
    
    const loadAndSyncSettings = async () => {
      // Prevent concurrent API calls
      if (isFetchingRef.current) {
        return;
      }
      
      // Step 1: Load from IndexedDB FIRST and show immediately
      let indexedDBSettings = null;
      try {
        const record = await ensureSettingsRecord();
        if (record && isMounted) {
          console.log('[Settings] Raw IndexedDB record:', {
            businessType: record.businessType,
            businessCategory: record.businessCategory,
            fullRecord: record
          });
          indexedDBSettings = convertRecordToSettingsState(record, currentUserEmail);
          const hasUnsynced = record.isSynced === false;
          
          // Show IndexedDB data immediately
          setSettings(indexedDBSettings);
          setHasUnsyncedChanges(hasUnsynced);
          
          console.log('[Settings] Loaded from IndexedDB - Converted settings:', {
            businessType: indexedDBSettings.businessType,
            businessCategory: record.businessCategory,
            rawBusinessType: record.businessType,
            rawBusinessCategory: record.businessCategory
          });
        }
      } catch (error) {
        console.error('[Settings] Error loading from IndexedDB:', error);
      }
      
      // Step 2: Fetch from backend API if online (in parallel, after showing IndexedDB)
      if (isOnline && isMounted && !isFetchingRef.current) {
        isFetchingRef.current = true;
        try {
          const response = await apiRequest('/data/seller/profile');
          
          // Handle nested response structure from apiRequest wrapper
          const sellerData = response.data?.data?.seller || response.data?.seller;
          
          if (response.success && sellerData && isMounted) {
            console.log('[Settings] Seller data from API (MongoDB):', {
              businessType: sellerData.businessType,
              businessCategory: sellerData.businessCategory,
              rawSellerData: sellerData
            });
            const backendSettings = mapUserToSettings(sellerData);
            console.log('[Settings] Mapped settings from MongoDB:', {
              businessType: backendSettings.businessType,
              fullSettings: backendSettings
            });
            
            // Step 3: Compare API data with IndexedDB data
            console.log('[Settings] Comparing IndexedDB vs MongoDB:', {
              indexedDB: indexedDBSettings?.businessType,
              mongodb: backendSettings.businessType,
              indexedDBRaw: indexedDBSettings,
              mongodbRaw: backendSettings
            });
            
            // Special handling for businessType: Prioritize actual values over defaults
            // If MongoDB has a real value (not 'Retail' default), use it
            // If MongoDB is null/undefined/'Retail' but IndexedDB has a real value, preserve IndexedDB's value
            const finalBackendSettings = { ...backendSettings };
            const mongoBusinessType = sellerData.businessType || sellerData.businessCategory;
            const indexedDBBusinessType = indexedDBSettings?.businessType;
            
            if (mongoBusinessType && mongoBusinessType.trim() !== '' && mongoBusinessType !== 'Retail') {
              // MongoDB has a real value, use it
              console.log('[Settings] Using MongoDB businessType value:', mongoBusinessType);
              finalBackendSettings.businessType = mongoBusinessType.trim();
            } else if (indexedDBBusinessType && indexedDBBusinessType !== 'Retail') {
              // MongoDB doesn't have a real value, but IndexedDB does - preserve it
              console.log('[Settings] Preserving IndexedDB businessType value:', indexedDBBusinessType);
              finalBackendSettings.businessType = indexedDBBusinessType;
            } else if (mongoBusinessType && mongoBusinessType.trim() !== '') {
              // MongoDB has a value (even if it's 'Retail'), use it
              console.log('[Settings] Using MongoDB businessType value (even if default):', mongoBusinessType);
              finalBackendSettings.businessType = mongoBusinessType.trim();
            }
            // Otherwise, keep the default 'Retail' from backendSettings
            
            const isDifferent = areSettingsDifferent(indexedDBSettings, finalBackendSettings);
            
            if (isDifferent) {
              console.log('[Settings] API data differs from IndexedDB, updating UI with:', {
                businessType: finalBackendSettings.businessType
              });
              // Update UI with API data if different (but preserve IndexedDB businessType if it's more specific)
              setSettings(finalBackendSettings);
              
              // Update currentUser in context (but don't trigger re-fetch)
              dispatch({ type: ActionTypes.UPDATE_USER, payload: sellerData });
              
              // Save to IndexedDB as synced with fresh API data (but preserve businessType if IndexedDB had a better value)
              const record = buildSettingsRecord(sellerId, finalBackendSettings, {
                isSynced: true,
                sellerEmail: finalBackendSettings.sellerEmail,
                syncedAt: new Date().toISOString()
              });
              await saveSettingsToIndexedDB(record);
              setHasUnsyncedChanges(false);
            } else {
              console.log('[Settings] API data matches IndexedDB, no update needed');
              // Data matches, but ensure IndexedDB record is marked as synced
              if (indexedDBSettings) {
                const record = buildSettingsRecord(sellerId, indexedDBSettings, {
                  isSynced: true,
                  sellerEmail: indexedDBSettings.sellerEmail,
                  syncedAt: new Date().toISOString()
                });
                await saveSettingsToIndexedDB(record);
              }
              
              // Still update currentUser in context with fresh data (but don't trigger re-fetch)
              dispatch({ type: ActionTypes.UPDATE_USER, payload: sellerData });
            }
          }
        } catch (error) {
          console.error('[Settings] Error fetching seller profile from API:', error);
          // If API fails, keep showing IndexedDB data (already shown)
        } finally {
          isFetchingRef.current = false;
        }
      } else if (!isOnline && isMounted) {
        // Offline: IndexedDB data already shown above
        console.log('[Settings] Offline mode - using IndexedDB data only');
      }
      
      // Fallback: If no IndexedDB data and offline, use currentUser
      if (!indexedDBSettings && state.currentUser && isMounted) {
        console.log('[Settings] Using currentUser fallback:', {
          businessType: state.currentUser.businessType,
          businessCategory: state.currentUser.businessCategory
        });
        const fallbackSettings = mapUserToSettings(state.currentUser);
        console.log('[Settings] Fallback settings:', {
          businessType: fallbackSettings.businessType
        });
        setSettings(fallbackSettings);
        const record = buildSettingsRecord(sellerId, fallbackSettings, {
          isSynced: true,
          sellerEmail: fallbackSettings.sellerEmail
        });
        saveSettingsToIndexedDB(record);
        setHasUnsyncedChanges(false);
      }
      
      hasLoadedRef.current = true;
    };

    loadAndSyncSettings();
    
    return () => {
      isMounted = false;
    };
  }, [sellerId, isOnline, currentUserEmail, ensureSettingsRecord]); // Removed state.currentUser and dispatch from dependencies

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isOnline && hasUnsyncedChanges) {
      syncSettingsToMongoDB({ silent: true });
    }
  }, [isOnline, hasUnsyncedChanges, syncSettingsToMongoDB]);

  // Debug: Log when businessType changes
  useEffect(() => {
    console.log('[Settings] businessType state changed:', {
      businessType: settings.businessType,
      isEditing,
      timestamp: new Date().toISOString()
    });
  }, [settings.businessType, isEditing]);

  const handleEditClick = () => {
    setIsEditing(true);
  };

  const handleSaveSettings = async () => {
    if (isSavingSettings) return;
    setIsSavingSettings(true);

    const lowStockValue = parseInt(settings.lowStockThreshold, 10);
    const expiryValue = parseInt(settings.expiryDaysThreshold, 10);
    
    if (isNaN(lowStockValue) || isNaN(expiryValue)) {
      if (window.showToast) {
        window.showToast('Please enter valid numbers for thresholds', 'error');
      }
      setIsSavingSettings(false);
      return;
    }

    if (!sellerId) {
      console.error('Seller ID missing. Cannot save settings.');
      if (window.showToast) {
        window.showToast('Seller ID missing. Please log in again.', 'error');
      }
      setIsSavingSettings(false);
      return;
    }

    const record = buildSettingsRecord(sellerId, {
      ...settings,
      sellerEmail: settings.sellerEmail,
      lowStockThreshold: lowStockValue,
      expiryDaysThreshold: expiryValue
    }, {
      isSynced: false,
      sellerEmail: settings.sellerEmail
    });

    try {
      await saveSettingsToIndexedDB(record);
      setHasUnsyncedChanges(true);

      if (state.currentUser) {
        const updatedUser = {
          ...state.currentUser,
          name: settings.sellerName,
          phoneNumber: settings.sellerPhone,
          shopName: settings.storeName,
          shopAddress: settings.businessAddress,
          city: settings.businessCity,
          state: settings.businessState,
          pincode: settings.businessPincode,
          gstNumber: settings.gstNumber,
          businessType: settings.businessType,
          upiId: settings.upiId.trim(),
          lowStockThreshold: lowStockValue,
          expiryDaysThreshold: expiryValue
        };
        dispatch({ type: ActionTypes.UPDATE_USER, payload: updatedUser });

        try {
          const authData = JSON.parse(localStorage.getItem('auth') || '{}');
          authData.currentUser = updatedUser;
          localStorage.setItem('auth', JSON.stringify(authData));
        } catch (storageError) {
          console.error('Error updating localStorage:', storageError);
        }
      }

      setIsEditing(false);

      if (!isOnline) {
        if (window.showToast) {
          window.showToast('Settings saved offline. They will sync automatically when online.', 'info');
        }
      } else {
        await syncSettingsToMongoDB({ silent: true });
        if (window.showToast) {
          window.showToast('Settings saved. Syncing with cloud...', 'info');
        }
      }
    } catch (error) {
      console.error('Error saving settings to IndexedDB:', error);
      if (window.showToast) {
        window.showToast('Failed to save settings locally.', 'error');
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCancelLogout = () => {
    if (isProcessingLogout) return;
    setShowLogoutModal(false);
    setLogoutUnsyncedSummary([]);
    setLogoutFeedback({ message: '', offline: false });
  };

  const handleConfirmLogout = async () => {
    if (isProcessingLogout) return;
    setIsProcessingLogout(true);

    try {
      // Only sync settings for sellers, not staff
      if (sellerId && !isStaffUser) {
        try {
          const record = await ensureSettingsRecord();
          if (record && record.isSynced === false) {
            if (!isOnline) {
              setLogoutFeedback({
                message: 'You are offline. Please go online to sync pending settings before logging out.',
                offline: true
              });
              setIsProcessingLogout(false);
              return;
            }

            const settingsSynced = await syncSettingsToMongoDB({ silent: true });
            if (!settingsSynced) {
              setLogoutFeedback({
                message: 'Unable to sync settings right now. Please try again shortly.',
                offline: false
              });
              setIsProcessingLogout(false);
              return;
            }
          }
        } catch (settingsCheckError) {
          console.error('Error checking settings sync status before logout:', settingsCheckError);
        }
      }

      const logoutResult = await dispatch({ type: 'REQUEST_LOGOUT' });

      if (!logoutResult?.success) {
        if (logoutResult?.unsynced?.length) {
          setLogoutUnsyncedSummary(logoutResult.unsynced);
        }
        if (logoutResult?.message && window.showToast) {
          window.showToast(logoutResult.message, logoutResult?.toastType || 'warning');
        }
        setLogoutFeedback({
          message: logoutResult?.message || '',
          offline: !!logoutResult?.offline
        });
        setIsProcessingLogout(false);
        return;
      }

      await signOut(auth);
      await dispatch({ type: ActionTypes.LOGOUT });
      if (window.showToast) {
        window.showToast('Logged out successfully.', 'success');
      }
      setShowLogoutModal(false);
    } catch (error) {
      console.error('Sign out error:', error);
      await dispatch({ type: ActionTypes.LOGOUT });
      if (window.showToast) {
        window.showToast('Logged out.', 'warning');
      }
      setShowLogoutModal(false);
    } finally {
      setIsProcessingLogout(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') {
      return;
    }

    setIsDeletingAccount(true);
    try {
      const response = await apiRequest('/auth/delete-account', {
        method: 'DELETE'
      });

      if (response.success) {
        if (window.showToast) {
          window.showToast('Account deleted successfully', 'success');
        }

        // Clear local data and logout
        localStorage.clear();
        sessionStorage.clear();

        // Sign out from Firebase
        await signOut(auth);

        // Redirect to login
        window.location.href = '/login';
      } else {
        if (window.showToast) {
          window.showToast(response.data?.message || 'Failed to delete account', 'error');
        }
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      if (window.showToast) {
        window.showToast('Failed to delete account. Please try again.', 'error');
      }
    } finally {
      setIsDeletingAccount(false);
      setShowDeleteModal(false);
      setDeleteConfirmation('');
    }
  };

  return (
    <>
      <div className="space-y-8 pb-16 max-w-4xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Settings</h2>
          <p className="text-gray-600 mt-2">
            {isStaffUser ? 'Manage your account settings and preferences' : 'Manage your business settings and preferences'}
          </p>
        </div>

        {hasUnsyncedChanges && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Changes saved while offline will sync automatically when you are back online.
              {isOnline ? ' Synchronizing now…' : ' Reconnect to sync with the cloud.'}
            </span>
          </div>
        )}

        <div className="card space-y-8">
          {/* Profile Section - Different for staff vs sellers */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2 text-blue-600" />
              {isStaffUser ? 'Staff Profile' : 'Seller Profile'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={settings.sellerName}
                  onChange={(e) => setSettings(prev => ({ ...prev, sellerName: e.target.value }))}
                  className="input-field"
                  placeholder="Enter your name"
                  disabled={!isEditing}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                <input
                  type="email"
                  value={settings.sellerEmail}
                  className="input-field"
                  disabled
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                <input
                  type="tel"
                  value={settings.sellerPhone}
                  onChange={(e) => setSettings(prev => ({ ...prev, sellerPhone: e.target.value }))}
                  className="input-field"
                  placeholder="Enter phone number"
                  disabled={!isEditing}
                />
              </div>
            </div>
          </div>

          {/* Business Profile */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Building2 className="h-5 w-5 mr-2 text-purple-600" />
              Business Profile
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Store/Business Name</label>
                <input
                  type="text"
                  value={settings.storeName}
                  onChange={(e) => setSettings(prev => ({ ...prev, storeName: e.target.value }))}
                  className="input-field"
                  placeholder="Enter store name"
                  disabled={!isEditing}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Business Type</label>
                {(() => {
                  const rawValue = settings.businessType || 'Retail';
                  const predefinedOptions = {
                    'retail': 'Retail',
                    'grocery': 'Grocery',
                    'wholesale': 'Wholesale',
                    'electronics': 'Electronics',
                    'clothing': 'Clothing',
                    'food': 'Food',
                    'pharmacy': 'Pharmacy',
                    'hardware': 'Hardware',
                    'other': 'Other'
                  };
                  
                  // Normalize value: try to match case-insensitively to predefined options
                  const normalizedValue = predefinedOptions[rawValue.toLowerCase()] || rawValue;
                  const valueExists = !!predefinedOptions[rawValue.toLowerCase()];
                  const needsDynamicOption = rawValue && rawValue !== 'Retail' && !valueExists;
                  
                  // Use normalized value for display, but keep original for saving
                  const displayValue = normalizedValue;
                  
                  return (
                    <>
                      <select
                        value={displayValue}
                        onChange={(e) => {
                          // When user selects, save the exact option value
                          setSettings(prev => ({ ...prev, businessType: e.target.value }));
                        }}
                        className="input-field"
                        disabled={!isEditing}
                      >
                        {/* Dynamically add current value as option if it's not in the predefined list */}
                        {needsDynamicOption && (
                          <option value={rawValue} key={`dynamic-${rawValue}`}>
                            {rawValue}
                          </option>
                        )}
                        <option value="Retail">Retail Store</option>
                        <option value="Grocery">Grocery Store</option>
                        <option value="Wholesale">Wholesale</option>
                        <option value="Electronics">Electronics</option>
                        <option value="Clothing">Clothing & Fashion</option>
                        <option value="Food">Food & Beverages</option>
                        <option value="Pharmacy">Pharmacy</option>
                        <option value="Hardware">Hardware</option>
                        <option value="Other">Other</option>
                      </select>
                    </>
                  );
                })()}
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Business Address</label>
                <textarea
                  value={settings.businessAddress}
                  onChange={(e) => setSettings(prev => ({ ...prev, businessAddress: e.target.value }))}
                  className="input-field"
                  rows="2"
                  placeholder="Enter complete business address"
                  disabled={!isEditing}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
                <input
                  type="text"
                  value={settings.businessCity}
                  onChange={(e) => setSettings(prev => ({ ...prev, businessCity: e.target.value }))}
                  className="input-field"
                  placeholder="Enter city"
                  disabled={!isEditing}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">State</label>
                <input
                  type="text"
                  value={settings.businessState}
                  onChange={(e) => setSettings(prev => ({ ...prev, businessState: e.target.value }))}
                  className="input-field"
                  placeholder="Enter state"
                  disabled={!isEditing}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Pincode</label>
                <input
                  type="text"
                  value={settings.businessPincode}
                  onChange={(e) => setSettings(prev => ({ ...prev, businessPincode: e.target.value }))}
                  className="input-field"
                  placeholder="Enter pincode"
                  disabled={!isEditing}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">GST Number</label>
                <input
                  type="text"
                  value={settings.gstNumber}
                  onChange={(e) => setSettings(prev => ({ ...prev, gstNumber: e.target.value }))}
                  className="input-field"
                  placeholder="Enter GST number (optional)"
                  disabled={!isEditing}
                />
              </div>
            </div>
          </div>

          {/* Payment Settings */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <CreditCard className="h-5 w-5 mr-2 text-green-600" />
              Payment Settings
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">UPI ID</label>
              <input
                type="text"
                value={settings.upiId}
                onChange={(e) => setSettings(prev => ({ ...prev, upiId: e.target.value }))}
                className="input-field"
                placeholder="e.g. store@upi"
                disabled={!isEditing}
              />
              <p className="text-xs text-gray-500 mt-1">
                Provide your business UPI ID to accept digital payments on invoices.
              </p>
            </div>
          </div>

          {/* Alert Settings */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Bell className="h-5 w-5 mr-2 text-yellow-600" />
              Alert Settings
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Low Stock Threshold</label>
                <input
                  type="number"
                  value={settings.lowStockThreshold}
                  onChange={(e) => setSettings(prev => ({ ...prev, lowStockThreshold: e.target.value }))}
                  className="input-field"
                  min="0"
                  placeholder="Enter threshold"
                  disabled={!isEditing}
                />
                <p className="text-sm text-gray-500 mt-1">
                  Products with stock at or below this number will trigger low stock alerts
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Expiry Days Threshold</label>
                <input
                  type="number"
                  value={settings.expiryDaysThreshold}
                  onChange={(e) => setSettings(prev => ({ ...prev, expiryDaysThreshold: e.target.value }))}
                  className="input-field"
                  min="0"
                  placeholder="Enter days"
                  disabled={!isEditing}
                />
                <p className="text-sm text-gray-500 mt-1">
                  Products expiring within this many days will trigger expiry alerts
                </p>
              </div>
            </div>
          </div>

          {/* Staff Permissions - Only for staff */}
          {isStaffUser && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Shield className="h-5 w-5 mr-2 text-green-600" />
                My Permissions
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-4">
                  These are the permissions granted to you by your administrator. If you need access to additional features,
                  please contact your administrator to update your permissions.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(state.currentUser?.permissions || state.permissions || {})
                    .filter(([, value]) => value)
                    .map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                        <span className="text-sm text-gray-700 capitalize">
                          {key.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                </div>
                {(!state.currentUser?.permissions && !state.permissions || (state.currentUser?.permissions && Object.keys(state.currentUser.permissions).length === 0) && (!state.permissions || Object.keys(state.permissions).length === 0)) && (
                  <p className="text-sm text-gray-500 italic">No permissions assigned yet.</p>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pt-6 border-t border-gray-200 gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLogoutModal(true)}
                className="btn-secondary flex items-center justify-center bg-red-50 text-red-600 hover:bg-red-100 border-red-300"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </button>
              
              {!isOnline && (
                <div className="flex items-center text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-lg border border-orange-200">
                  <WifiOff className="h-3 w-3 mr-1.5" />
                  Offline
                </div>
              )}
            </div>
            
            {!isStaffUser && (
              <>
                {!isEditing ? (
                  <button
                    onClick={handleEditClick}
                    className="btn-primary flex items-center justify-center"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Settings
                  </button>
                ) : (
                  <button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className={`btn-primary flex items-center justify-center ${isSavingSettings ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isSavingSettings ? 'Saving...' : 'Save Settings'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Danger Zone - Delete Account */}
        <div className="card border-red-200 bg-red-50">
          <div className="flex items-center mb-4">
            <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
            <h3 className="text-lg font-semibold text-red-900">Danger Zone</h3>
          </div>

          <div className="bg-white rounded-lg border border-red-200 p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-gray-900">Delete Account</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Permanently delete your account and all associated data. This action cannot be undone.
                  {state.currentUser?.userType === 'seller' ?
                    ' All your products, orders, staff, and business data will be permanently removed.' :
                    ' Your staff account and all associated data will be permanently removed.'
                  }
                </p>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="btn-secondary bg-red-600 text-white hover:bg-red-700 border-red-600"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-red-900">Delete Account</h3>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4">
              <div className="flex items-center text-red-600 mb-3">
                <AlertTriangle className="h-5 w-5 mr-2" />
                <span className="font-medium">This action cannot be undone</span>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                This will permanently delete your {state.currentUser?.userType === 'seller' ? 'seller account' : 'staff account'} and remove all associated data from our servers.
              </p>

              {state.currentUser?.userType === 'seller' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-700 font-medium mb-2">The following data will be permanently deleted:</p>
                  <ul className="text-sm text-red-700 space-y-1">
                    <li>• Your business profile and settings</li>
                    <li>• All products and inventory data</li>
                    <li>• All orders and transaction history</li>
                    <li>• All staff accounts and permissions</li>
                    <li>• All reports and analytics data</li>
                  </ul>
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-700">
                  <strong>Warning:</strong> To confirm deletion, type "DELETE" in the field below.
                </p>
                <p className="text-xs text-yellow-600 mt-1">
                  This action is permanent and cannot be reversed.
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type "DELETE" to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  className="input-field border-red-300 focus:border-red-500 focus:ring-red-500"
                  placeholder="Type DELETE here"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="btn-secondary"
                disabled={isDeletingAccount}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeletingAccount || deleteConfirmation !== 'DELETE'}
                className="btn-primary bg-red-600 hover:bg-red-700 disabled:bg-red-400"
              >
                {isDeletingAccount ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Confirm Logout</h3>
              <button
                onClick={handleCancelLogout}
                className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-600">
              {logoutUnsyncedSummary.length > 0
                ? 'We detected pending offline changes.'
                : 'Make sure all your data is synced before logging out.'}
            </p>

            {logoutUnsyncedSummary.length > 0 && (
              <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4">
                <div className="flex items-center text-sm font-medium text-orange-700">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Pending sync items
                </div>
                <ul className="mt-2 space-y-1 text-sm text-orange-700">
                  {logoutUnsyncedSummary.map(item => (
                    <li key={item.key} className="flex justify-between">
                      <span>{item.label}</span>
                      <span className="font-medium">{item.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isProcessingLogout && (
              <div className="mt-4 flex items-center text-sm text-gray-500">
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Checking unsynced data...
              </div>
            )}

            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={handleCancelLogout}
                className="btn-secondary"
                disabled={isProcessingLogout}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLogout}
                className="btn-primary bg-red-500 hover:bg-red-600"
                disabled={isProcessingLogout}
              >
                {isProcessingLogout ? 'Syncing...' : 'Logout'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Export the main Settings component that handles both staff and seller
export default Settings;

