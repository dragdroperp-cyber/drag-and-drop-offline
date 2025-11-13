import React, { useState, useEffect, useCallback } from 'react';
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
  Edit
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { apiRequest } from '../../utils/api';
import { STORES, addItem, updateItem, getItem } from '../../utils/indexedDB';

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

const mapUserToSettings = (user) => ({
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
  businessCategory: user?.businessCategory || 'Retail'
});

const buildSettingsRecord = (sellerId, settings, overrides = {}) => ({
  id: `settings_${sellerId}`,
  sellerId,
  ...settings,
  updatedAt: new Date().toISOString(),
  isSynced: false,
  ...overrides
});

const convertRecordToSettingsState = (record, fallbackEmail = '') => ({
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
  businessCategory: record?.businessCategory || 'Retail'
});

const buildRequestBody = (settings) => ({
  upiId: settings.upiId.trim(),
  username: settings.sellerName,
  phone: settings.sellerPhone,
  address: settings.businessAddress,
  city: settings.businessCity,
  state: settings.businessState,
  pincode: settings.businessPincode,
  businessCategory: settings.businessCategory,
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

const Settings = () => {
  const { state, dispatch } = useApp();
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
    businessCategory: 'Retail'
  });
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isProcessingLogout, setIsProcessingLogout] = useState(false);
  const [logoutUnsyncedSummary, setLogoutUnsyncedSummary] = useState([]);
  const [logoutFeedback, setLogoutFeedback] = useState({ message: '', offline: false });

  const sellerId = getSellerId(state.currentUser);
  const currentUserEmail = state.currentUser?.email || '';

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

  const loadSettingsFromIndexedDB = useCallback(async () => {
    if (!sellerId) return;
    try {
      const record = await ensureSettingsRecord();
      if (record) {
        const recordSettings = convertRecordToSettingsState(record, currentUserEmail);
        const hasUnsynced = record.isSynced === false;
        if (hasUnsynced || !state.currentUser) {
          setSettings(recordSettings);
        }
        setHasUnsyncedChanges(hasUnsynced);
      }
    } catch (error) {
      console.error('Error loading settings from IndexedDB:', error);
    }
  }, [sellerId, state.currentUser, currentUserEmail, ensureSettingsRecord]);

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
                businessCategory: record.businessCategory,
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

  // Fetch fresh seller data from backend when component loads (prioritize this over state.currentUser)
  useEffect(() => {
    if (!sellerId) return;
    
    let isMounted = true;
    
    const fetchSellerProfile = async () => {
      // If online, fetch fresh data from backend
      if (isOnline) {
        try {
          const response = await apiRequest('/data/seller/profile');
          
          // Handle nested response structure from apiRequest wrapper
          const sellerData = response.data?.data?.seller || response.data?.seller;
          
          if (response.success && sellerData && isMounted) {
            const backendSettings = mapUserToSettings(sellerData);
            setSettings(backendSettings);
            
            // Update currentUser in context
            dispatch({ type: ActionTypes.UPDATE_USER, payload: sellerData });
            
            // Save to IndexedDB as synced
            const record = buildSettingsRecord(sellerId, backendSettings, {
              isSynced: true,
              sellerEmail: backendSettings.sellerEmail
            });
            await saveSettingsToIndexedDB(record);
            setHasUnsyncedChanges(false);
            return; // Exit early if fetch succeeded
          }
        } catch (error) {
          console.error('[Settings] Error fetching seller profile:', error);
        }
      }
      
      // Load from IndexedDB if offline or fetch failed
      if (isMounted) {
        try {
          const record = await ensureSettingsRecord();
          if (record && isMounted) {
            const recordSettings = convertRecordToSettingsState(record, currentUserEmail);
            const hasUnsynced = record.isSynced === false;
            if (hasUnsynced || !state.currentUser) {
              setSettings(recordSettings);
            }
            setHasUnsyncedChanges(hasUnsynced);
            return;
          }
        } catch (error) {
          console.error('[Settings] Error loading from IndexedDB:', error);
        }
      }
      
      // Fallback to currentUser if offline or fetch fails
      if (state.currentUser && isMounted) {
        const backendSettings = mapUserToSettings(state.currentUser);
        setSettings(backendSettings);
        const record = buildSettingsRecord(sellerId, backendSettings, {
          isSynced: true,
          sellerEmail: backendSettings.sellerEmail
        });
        saveSettingsToIndexedDB(record);
        setHasUnsyncedChanges(false);
      }
    };

    fetchSellerProfile();
    
    return () => {
      isMounted = false;
    };
  }, [sellerId, isOnline, dispatch, currentUserEmail, ensureSettingsRecord]);

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
          businessCategory: settings.businessCategory,
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
      if (sellerId) {
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

  return (
    <>
      <div className="space-y-8 pb-16 max-w-4xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Settings</h2>
          <p className="text-gray-600 mt-2">Manage your business settings and preferences</p>
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
          {/* Seller Profile */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2 text-blue-600" />
              Seller Profile
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Business Category</label>
                <select
                  value={settings.businessCategory}
                  onChange={(e) => setSettings(prev => ({ ...prev, businessCategory: e.target.value }))}
                  className="input-field"
                  disabled={!isEditing}
                >
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
          </div>
        </div>
      </div>

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

export default Settings;

