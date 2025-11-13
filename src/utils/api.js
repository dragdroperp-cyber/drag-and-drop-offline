/**
 * API Configuration and Utilities
 * Centralized API connection management for frontend-backend communication
 */

// API Base URL - can be configured via environment variable
export const API_BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:5000') + '/api';

/**
 * Check if backend is available
 */
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
    }

    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...(sellerId && { 'x-seller-id': sellerId })
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
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
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.seller) {
        return { success: true, sellerId: data.seller._id, seller: data.seller };
      }
    }
    
    const errorData = await response.json().catch(() => ({}));
    return { 
      success: false, 
      error: errorData.message || 'Failed to get seller ID',
      status: response.status
    };
  } catch (error) {
    console.error('Get seller ID error:', error);
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

export default {
  API_BASE_URL,
  checkBackendHealth,
  apiRequest,
  getSellerId,
  syncData
};

