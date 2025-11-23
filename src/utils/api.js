/**
 * API Configuration and Utilities
 * Centralized API connection management for frontend-backend communication
 */

// API Base URL - can be configured via environment variable
export const API_BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:5000') + '/api';

/**
 * Check if backend is available
 */
/**
 * Refresh staff permissions from server
 * Useful when permissions might have changed
 */
export const refreshStaffPermissions = async () => {
  try {
    const auth = localStorage.getItem('auth');
    if (!auth) {
      console.log('No auth data found for permission refresh');
      return null;
    }

    const authData = JSON.parse(auth);
    if (authData.currentUser?.userType !== 'staff') {
      console.log('Not a staff user, skipping permission refresh');
      return null;
    }

    console.log('🔄 Refreshing staff permissions from server...');

    // Get current Firebase user
    const { auth: firebaseAuth } = await import('./firebase');
    const currentUser = firebaseAuth.currentUser;

    if (!currentUser) {
      console.log('No Firebase user found for permission refresh');
      return null;
    }

    // Re-authenticate to get fresh permissions
    const result = await getStaffAuth(
      currentUser.email,
      currentUser.uid,
      currentUser.displayName,
      currentUser.photoURL
    );

    if (result.success) {
      console.log('✅ Staff permissions refreshed:', result.staff.permissions);

      // Update localStorage with fresh permissions
      const updatedAuthData = {
        ...authData,
        currentUser: {
          ...authData.currentUser,
          permissions: result.staff.permissions
        }
      };
      localStorage.setItem('auth', JSON.stringify(updatedAuthData));

      return result.staff.permissions;
    } else {
      console.error('❌ Failed to refresh staff permissions:', result.error);
      return null;
    }
  } catch (error) {
    console.error('Error refreshing staff permissions:', error);
    return null;
  }
};

export const checkBackendHealth = async () => {
  try {
    // Use base URL without /api for health check
    const baseUrl = API_BASE_URL.replace('/api', '') || 'http://localhost:5000';
    
    // Create timeout promise for health check
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Health check timeout')), 5000)
    );
    
    const fetchPromise = fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (response && response.ok) {
      const data = await response.json();
      return { available: true, data };
    }
    return { available: false, error: 'Backend health check failed' };
  } catch (error) {
    if (error.message === 'Health check timeout') {
      return { available: false, error: 'Backend connection timeout' };
    }
    console.error('Backend health check error:', error);
    return { available: false, error: error.message || 'Backend not reachable' };
  }
};

/**
 * Make authenticated API request
 */
export const apiRequest = async (endpoint, options = {}) => {
  try {
    // Get sellerId from localStorage
    const auth = localStorage.getItem('auth');
    let sellerId = null;

    if (auth) {
      try {
        const authData = JSON.parse(auth);
        sellerId = authData.sellerId || authData.currentUser?.sellerId;
      } catch (e) {
        console.error('Error parsing auth data:', e);
      }
    } else {
      console.log('API Request - no auth data found in localStorage');
    }

    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...(sellerId && { 'x-seller-id': sellerId })
    };

    const finalHeaders = {
      ...defaultHeaders,
      ...options.headers
    };

    // Only log API errors, not every request
    if (!sellerId && finalHeaders['x-seller-id']) {
      console.warn(`🚨 API Request missing sellerId for ${endpoint}`);
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: finalHeaders,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    console.log(`📡 Response status for ${endpoint}: ${response.status} ${response.statusText}`);

    // Get raw response text first
    const responseText = await response.text();
    console.log(`📄 Raw response for ${endpoint}:`, responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));

    let data;
    try {
      data = JSON.parse(responseText);
      console.log(`✅ Parsed API Response (${endpoint}):`, data);
    } catch (parseError) {
      console.error(`❌ Failed to parse JSON response for ${endpoint}:`, parseError);
      data = {};
    }

    if (!response.ok) {
      // Check for seller not found errors (automatic logout and data cleanup)
      if (response.status === 403 || response.status === 404) {
        const errorMessage = data.message || '';
        const isSellerError = errorMessage.toLowerCase().includes('seller') &&
            (errorMessage.toLowerCase().includes('not found') ||
             errorMessage.toLowerCase().includes('inactive') ||
             errorMessage.toLowerCase().includes('deactivated'));

        // Special handling for /api/data/all endpoint - logout and clear data
        const isDataAllEndpoint = endpoint.includes('/data/all');

        if (isSellerError || isDataAllEndpoint) {
          console.log(`🚨 Seller/account error detected on ${endpoint} - automatically logging out user and clearing data`);

          // Import required utilities
          const clearIndexedDBData = async () => {
            try {
              // Import IndexedDB functions
              const { STORES, clearAllItems } = await import('../utils/indexedDB');

              // Check if all data is synced before clearing
              const { getAllItems } = await import('../utils/indexedDB');

              // Check a few key stores to see if data is synced
              const [products, customers, orders] = await Promise.all([
                getAllItems(STORES.products).catch(() => []),
                getAllItems(STORES.customers).catch(() => []),
                getAllItems(STORES.orders).catch(() => [])
              ]);

              // Check if all items are synced (isSynced flag)
              const hasUnsyncedData = [...products, ...customers, ...orders].some(item =>
                item && item.isSynced === false
              );

              if (hasUnsyncedData) {
                console.warn('⚠️ Found unsynced data - skipping IndexedDB cleanup to prevent data loss');
                return false;
              }

              // Clear all IndexedDB stores
              const stores = [
                STORES.products, STORES.customers, STORES.orders,
                STORES.transactions, STORES.purchaseOrders, STORES.categories,
                STORES.refunds, STORES.activities, STORES.syncMetadata,
                STORES.staff, STORES.staffPermissions
              ];

              await Promise.all(stores.map(store => clearAllItems(store).catch(() => {})));
              console.log('🗑️ Cleared all IndexedDB data');
              return true;
            } catch (error) {
              console.error('❌ Error clearing IndexedDB data:', error);
              return false;
            }
          };

          // Clear IndexedDB data if synced
          await clearIndexedDBData();

          // Clear all localStorage data
          localStorage.clear();
          console.log('🗑️ Cleared all localStorage data');

          // Dispatch logout action
          try {
            const { ActionTypes } = await import('../context/AppContext');
            if (window.globalDispatch) {
              window.globalDispatch({ type: ActionTypes.LOGOUT });
            }
          } catch (dispatchError) {
            console.error('Error dispatching logout:', dispatchError);
          }

          // Show toast message
          if (window.showToast) {
            window.showToast('Your account has been deactivated. All data has been cleared.', 'error');
          }

          // Redirect to login after a short delay
          setTimeout(() => {
            window.location.href = '/login';
          }, 2000);

          return {
            success: false,
            error: 'Your account has been deactivated. Data cleared and redirecting to login...',
            autoLogout: true
          };
        }
      }

      throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    return { success: true, data };
  } catch (error) {
    console.error(`API request error (${endpoint}):`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Extract sellerId from authenticated seller (from localStorage)
 * Same method used by apiRequest for consistency
 * @returns {string|null} - The sellerId or null if not found
 */
export const getSellerIdFromAuth = () => {
  try {
    const auth = localStorage.getItem('auth');
    if (!auth) return null;
    
    const authData = JSON.parse(auth);
    return authData.sellerId || authData.currentUser?.sellerId || null;
  } catch (error) {
    console.error('Error extracting sellerId from auth:', error);
    return null;
  }
};

/**
 * Get seller ID from backend (for auth)
 */
export const getSellerId = async (email, uid, displayName, photoURL) => {
  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

  try {
    const response = await fetch(`${API_BASE_URL}/auth/seller`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        uid,
        displayName,
        photoURL
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.seller) {
        return { success: true, sellerId: data.seller._id, seller: data.seller, userType: 'seller' };
      }
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.message || 'Failed to get seller ID',
      status: response.status
    };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Get seller ID error:', error);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timeout. Please check your connection and try again.', status: 408 };
    }
    return { success: false, error: error.message };
  }
};

export const getStaffAuth = async (email, uid, displayName, photoURL) => {
  console.log(`🔍 Calling staff auth API for: ${email}`);

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

  try {
    const response = await fetch(`${API_BASE_URL}/staff/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        uid,
        displayName,
        photoURL
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`📡 Staff auth response status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Staff auth response data:`, data);

      if (data.success && data.staff) {
        console.log(`✅ Staff auth successful for ${email}`);
        return { success: true, staffId: data.staff._id, staff: data.staff, seller: data.seller, userType: 'staff' };
      }
    }

    const errorData = await response.json().catch(() => ({}));
    console.log(`❌ Staff auth failed for ${email}:`, errorData);
    return {
      success: false,
      error: errorData.message || 'Failed to authenticate staff',
      status: response.status
    };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`💥 Staff auth network error for ${email}:`, error);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timeout. Please check your connection and try again.', status: 408 };
    }
    return { success: false, error: error.message };
  }
};

export const updateSellerProfile = async (profile) => {
  console.log('📤 Updating seller profile with data:', profile);
  
  // Make sure we have sellerId for authentication
  const auth = localStorage.getItem('auth');
  if (!auth) {
    console.error('❌ No auth data found in localStorage');
    return { success: false, error: 'Not authenticated. Please log in again.' };
  }

  let sellerId;
  try {
    const authData = JSON.parse(auth);
    sellerId = authData.sellerId || authData.currentUser?.sellerId || authData.currentUser?._id;
    console.log('🔑 Using sellerId:', sellerId);
  } catch (e) {
    console.error('❌ Error parsing auth data:', e);
    return { success: false, error: 'Invalid authentication data' };
  }

  if (!sellerId) {
    console.error('❌ No sellerId found in auth data');
    return { success: false, error: 'Seller ID not found. Please log in again.' };
  }

  return apiRequest('/auth/seller/profile', {
    method: 'PUT',
    body: {
      ...profile,
      sellerId
    }
  });
};

/**
 * Sync data to backend
 */
export const syncData = async (storeName, items, sellerId) => {
  const endpointMap = {
    customers: '/sync/customers',
    products: '/sync/products',
    orders: '/sync/orders',
    transactions: '/sync/transactions',
    purchaseOrders: '/sync/vendor-orders',
    categories: '/sync/categories'
  };

  const endpoint = endpointMap[storeName];
  if (!endpoint) {
    console.error(`[syncData] Unknown store: ${storeName}`);
    return { success: false, error: `Unknown store: ${storeName}` };
  }

  console.log(`[syncData] Syncing ${storeName} to endpoint: ${endpoint}`);
  console.log(`[syncData] Items count: ${Array.isArray(items) ? items.length : 1}`);
  console.log(`[syncData] SellerId: ${sellerId || 'from header'}`);

  // Backend expects items array in body, sellerId comes from auth middleware
  const requestBody = {
    items: Array.isArray(items) ? items : [items]
  };
  
  // Only include sellerId if explicitly provided (for backward compatibility)
  // But normally sellerId comes from auth middleware via x-seller-id header
  if (sellerId) {
    requestBody.sellerId = sellerId;
  }
  
  console.log(`[syncData] Request body:`, JSON.stringify(requestBody, null, 2));
  console.log(`[syncData] Making API request to: ${API_BASE_URL}${endpoint}`);
  
  const result = await apiRequest(endpoint, {
    method: 'POST',
    body: requestBody
  });
  
  console.log(`[syncData] API response for ${storeName}:`, result);
  
  return result;
};

/**
 * Create order directly on backend (immediate sync)
 */
export const createOrder = async (order) => {
  try {
    console.log('📤 [createOrder] Starting order creation API call...', order.id);
    console.log('📤 [createOrder] Order data:', JSON.stringify(order, null, 2));
    
    // Get sellerId from auth to ensure it's available
    const sellerId = getSellerIdFromAuth();
    console.log('📤 [createOrder] SellerId from auth:', sellerId);
    
    if (!sellerId) {
      console.error('❌ [createOrder] No sellerId found in auth!');
      return {
        success: false,
        error: 'No sellerId found. Please login again.'
      };
    }
    
    console.log('📤 [createOrder] Calling syncData with storeName: orders');
    const result = await syncData('orders', order, sellerId);
    
    console.log('📥 [createOrder] Backend response:', result);
    console.log('📥 [createOrder] Response success:', result.success);
    console.log('📥 [createOrder] Response data:', result.data);
    
    if (result.success && result.data) {
      // Check response format - backend returns { success: true, results: { success: [...], failed: [...] } }
      const results = result.data.results || result.data;
      const successItems = results.success || [];
      
      console.log('📥 [createOrder] Success items:', successItems);
      
      if (successItems.length > 0) {
        const syncedOrder = successItems.find(item => item.id === order.id) || successItems[0];
        console.log('✅ [createOrder] Order created on backend:', syncedOrder);
        return {
          success: true,
          _id: syncedOrder._id,
          order: syncedOrder,
          action: syncedOrder.action || 'created'
        };
      } else {
        console.error('❌ [createOrder] Order creation failed - no success items:', result);
        console.error('❌ [createOrder] Failed items:', results.failed || []);
        return {
          success: false,
          error: result.data.message || 'Order creation failed - no success response'
        };
      }
    } else {
      console.error('❌ [createOrder] Order creation failed:', result);
      return {
        success: false,
        error: result.error || result.data?.message || 'Order creation failed'
      };
    }
  } catch (error) {
    console.error('❌ [createOrder] Exception creating order:', error);
    console.error('❌ [createOrder] Error stack:', error.stack);
    return {
      success: false,
      error: error.message || 'Failed to create order'
    };
  }
};

export const registerSeller = async (registrationData) => {
  console.log('📝 Registering new seller account');

  try {
    const response = await fetch(`${API_BASE_URL}/auth/seller/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(registrationData)
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.seller) {
        return { success: true, seller: data.seller };
      }
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.message || 'Registration failed',
      status: response.status
    };
  } catch (error) {
    console.error('Registration error:', error);
    return { success: false, error: error.message };
  }
};

export default {
  API_BASE_URL,
  checkBackendHealth,
  apiRequest,
  getSellerId,
  getStaffAuth,
  registerSeller,
  syncData
};

