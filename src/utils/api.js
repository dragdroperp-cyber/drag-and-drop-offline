/**
 * API Configuration and Utilities
 * Centralized API connection management for frontend-backend communication
 */

import { auth } from './firebase';
import { getCachedResponse, cacheResponse, clearCache } from './cache';
import { networkAwareApiRequest } from './networkRetry';

// API Base URL - can be configured via environment variable
export const API_BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:5000') + '/api';

// Cache to prevent duplicate getSellerId calls
const sellerIdCache = new Map();
const sellerIdInProgress = new Set();

/**
 * Helper to get cookie value by name
 */
const getCookie = (name) => {
    if (typeof document === 'undefined') return null;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
};

/**
 * Make authenticated API request
 */
export const apiRequest = async (endpoint, options = {}) => {

    try {
        // Get sellerId and sessionId from localStorage
        const authStore = localStorage.getItem('auth');
        let sellerId = null;
        let sessionId = null;

        if (authStore) {
            try {
                const authData = JSON.parse(authStore);
                sellerId = authData.sellerId || authData.currentUser?.sellerId;
                sessionId = authData.currentSessionId || null;
            } catch (e) {
                // Ignore parsing errors
            }
        }

        // Check cache for GET requests (avoid caching mutations)
        // EXEMPT: Critical plan and sync endpoints should never be cached as they control permissions/state
        const noCacheEndpoints = ['/current-plan', '/plans/usage', '/all', '/delta-sync', '/sync-tracking', '/targets'];
        const isCriticalEndpoint = noCacheEndpoints.some(e => endpoint.includes(e));

        if ((options.method === 'GET' || (!options.method && !options.body)) && !isCriticalEndpoint) {
            const cacheType = endpoint.includes('/products') ? 'products' :
                endpoint.includes('/customers') ? 'customers' :
                    endpoint.includes('/orders') ? 'orders' :
                        endpoint.includes('/transactions') ? 'transactions' :
                            endpoint.includes('/categories') ? 'categories' :
                                endpoint.includes('/reports') ? 'reports' :
                                    endpoint.includes('/dashboard') ? 'dashboard' : 'default';

            const cachedResponse = await getCachedResponse('GET', endpoint, null, sellerId, cacheType);
            if (cachedResponse) {
                return cachedResponse;
            }
        }

        const xsrfToken = getCookie('XSRF-TOKEN');

        const defaultHeaders = {
            'Content-Type': 'application/json',
            ...(sellerId && { 'x-seller-id': sellerId }),
            ...(sessionId && { 'x-session-id': sessionId }),
            ...(xsrfToken && { 'x-xsrf-token': xsrfToken })
        };

        const finalHeaders = {
            ...defaultHeaders,
            ...options.headers
        };

        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: finalHeaders,
            credentials: 'include',
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        // Get raw response text first
        const responseText = await response.text();

        let data;

        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            data = {};
        }

        if (!response.ok) {
            // Check for multi-device login security error (Hard Lock)
            if (response.status === 403 && data.isReadOnlyMode) {
                console.warn('⛔ Security Lock: Multi-device login detected via API.');
                if (window.globalDispatch) {
                    window.globalDispatch({ type: 'SET_READ_ONLY_MODE', payload: true });
                }
                return {
                    success: false,
                    error: 'Security Lock: This account is active on another device.',
                    isReadOnlyMode: true
                };
            }

            // Check for plan validation errors - don't redirect, just show warning
            if (response.status === 403 && data.planInvalid) {
                // Show plan expired warning but don't redirect - allow UI access
                if (window.showToast) {
                    window.showToast(data.message || 'Your plan has expired. You can still view data but cannot create, update, or delete items. Please upgrade your plan.', 'warning', 8000);
                }

                return {
                    success: false,
                    error: data.message || 'Plan expired - operation not allowed',
                    planInvalid: true,
                    planStatus: data.planStatus,
                    data: data // Include the data even on 403 for read-only access
                };
            }

            // AUTO-REFRESH TOKEN LOGIC for 401 "Authentication required"
            if (response.status === 401 &&
                (data.message === 'Authentication required. Please log in again.' || data.message === 'Invalid or expired token') &&
                !options._isRetry) {

                try {
                    console.log('🔄 401 detected, attempting automatic token refresh...');
                    const user = auth.currentUser;

                    if (user) {
                        // Get fresh Firebase token
                        const idToken = await user.getIdToken(true);
                        console.log('✅ Firebase token refreshed');

                        // Re-authenticate with backend to set fresh cookie
                        const loginResult = await getSellerId(
                            user.email,
                            user.uid,
                            user.displayName,
                            user.photoURL,
                            idToken
                        );

                        if (loginResult.success) {
                            console.log('✅ Backend session refreshed, retrying request...'); // Retry original request with same options

                            // Important: Pass _isRetry to prevent infinite loops
                            return apiRequest(endpoint, {
                                ...options,
                                headers: {
                                    ...options.headers,
                                    // Ensure we don't accidentally send old headers if any were hardcoded, though apiRequest rebuilds them
                                },
                                _isRetry: true
                            });
                        } else {
                            console.warn('❌ Failed to refresh backend session:', loginResult.error);
                        }
                    } else {
                        console.warn('⚠️ No Firebase user found for refresh');
                    }
                } catch (refreshError) {
                    console.error('❌ Error during auto-refresh:', refreshError);
                }
            }

            const errorMessage = data.message || '';
            const isSellerError = errorMessage.toLowerCase().includes('seller') &&
                (errorMessage.toLowerCase().includes('not found') ||
                    errorMessage.toLowerCase().includes('inactive') ||
                    errorMessage.toLowerCase().includes('deactivated'));

            const isAuthRequiredError = errorMessage === 'Authentication required. Please log in again.' && endpoint.includes('/all');

            // IMPORTANT: Don't treat expired plan errors as seller errors
            if ((isSellerError || isAuthRequiredError) && !data.planInvalid) {

                // Import required utilities
                const checkUnsyncedData = async () => {
                    try {
                        // Check if sync queue has any pending operations
                        const syncQueue = JSON.parse(localStorage.getItem('syncQueue') || '[]');
                        if (syncQueue.length > 0) {
                            return true;
                        }

                        // Import IndexedDB functions
                        const { STORES, getAllItems } = await import('../utils/indexedDB');

                        // Check a few key stores to see if data is synced
                        const [products, customers, orders, transactions, purchaseOrders, productBatches] = await Promise.all([
                            getAllItems(STORES.products).catch(() => []),
                            getAllItems(STORES.customers).catch(() => []),
                            getAllItems(STORES.orders).catch(() => []),
                            getAllItems(STORES.transactions).catch(() => []),
                            getAllItems(STORES.purchaseOrders).catch(() => []),
                            getAllItems(STORES.productBatches).catch(() => [])
                        ]);

                        // Check if all items are synced (isSynced flag)
                        const allData = [...products, ...customers, ...orders, ...transactions, ...purchaseOrders, ...productBatches];
                        const hasUnsyncedData = allData.some(item =>
                            item && item.isSynced === false
                        );

                        if (hasUnsyncedData) {
                            return true; // Has unsynced data, skip logout
                        }

                        return false; // No unsynced data, can proceed with logout
                    } catch (error) {
                        return true; // Error occurred, skip logout to be safe
                    }
                };

                // Check for unsynced data before proceeding
                const hasUnsyncedData = await checkUnsyncedData();

                if (hasUnsyncedData) {
                    // Don't logout or clear data - show warning instead
                    if (window.showToast) {
                        const warningMsg = isAuthRequiredError
                            ? 'Your session has expired, but you have unsynced data. Please connect to internet and sync your data to cloud first to avoid data loss.'
                            : 'Account access issue detected, but you have unsynced data. Please connect to internet and sync your data to cloud first, otherwise this data may be lost.';
                        window.showToast(warningMsg, 'warning');
                    }
                    // Return the error without logging out
                    throw new Error(isAuthRequiredError ? 'Authentication required with unsynced data - logout prevented' : 'Account access issue with unsynced data - logout prevented');
                }

                // Only proceed with logout and data clearing if no unsynced data

                const clearIndexedDBData = async () => {
                    try {
                        // Import IndexedDB functions
                        const { STORES, clearAllItems } = await import('../utils/indexedDB');

                        // Clear all IndexedDB stores
                        const stores = [
                            STORES.products, STORES.customers, STORES.orders,
                            STORES.transactions, STORES.purchaseOrders, STORES.categories,
                            STORES.refunds, STORES.activities, STORES.syncMetadata,
                            STORES.productBatches, STORES.planDetails, STORES.planOrders,
                            STORES.staffPermissions, STORES.settings
                        ];

                        await Promise.all(stores.map(store => clearAllItems(store).catch(() => { })));

                        return true;
                    } catch (error) {
                        return false;
                    }
                };

                // Clear IndexedDB data
                await clearIndexedDBData();

                // Clear all localStorage data
                localStorage.clear();

                // Dispatch logout action (bypass data protection since this is an account error)
                try {
                    const { ActionTypes } = await import('../context/AppContext');
                    if (window.globalDispatch) {
                        window.globalDispatch({ type: ActionTypes.LOGOUT });
                    }
                } catch (dispatchError) {
                }

                // Show toast message
                if (window.showToast) {
                    const toastMsg = isAuthRequiredError
                        ? 'Your session has expired. Please log in again.'
                        : 'Your account has been deactivated. All data has been cleared.';
                    window.showToast(toastMsg, 'error');
                }

                // Redirect to login after a short delay
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);

                return {
                    success: false,
                    error: isAuthRequiredError
                        ? 'Session expired. Data cleared and redirecting to login...'
                        : 'Your account has been deactivated. Data cleared and redirecting to login...',
                    autoLogout: true
                };
            }

            // Create error object with details if available
            const error = new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
            if (data.details) {
                error.details = data.details;
            }
            throw error;
        }

        // Handle 200 OK with Read-Only Mode (Soft Lock)
        // If the backend allows the request (e.g. /all for data fetching) but flags it as read-only
        if (response.ok && data.isReadOnlyMode) {
            console.warn('⛔ Security Warning: Multi-device login detected via API (Soft Lock).');
            if (window.globalDispatch) {
                window.globalDispatch({ type: 'SET_READ_ONLY_MODE', payload: true });
            }
            // We continue to return success: true so data loads
        }

        // Cache successful GET responses (if not exempted)
        if ((options.method === 'GET' || (!options.method && !options.body)) && response.ok && !isCriticalEndpoint) {
            const cacheType = endpoint.includes('/products') ? 'products' :
                endpoint.includes('/customers') ? 'customers' :
                    endpoint.includes('/orders') ? 'orders' :
                        endpoint.includes('/transactions') ? 'transactions' :
                            endpoint.includes('/categories') ? 'categories' :
                                endpoint.includes('/reports') ? 'reports' :
                                    endpoint.includes('/dashboard') ? 'dashboard' : 'default';

            await cacheResponse('GET', endpoint, null, { success: true, data }, sellerId, cacheType);
        }

        // Clear cache for mutations (POST, PUT, DELETE)
        if (options.method && options.method !== 'GET' && response.ok) {
            // Clear cache for this endpoint and potentially related ones
            // Using the base endpoint without query parameters
            const baseEndpoint = endpoint.split('?')[0];
            await clearCache(baseEndpoint);
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
        const authStore = localStorage.getItem('auth');
        if (!authStore) return null;

        const authData = JSON.parse(authStore);
        return authData.sellerId || authData.currentUser?.sellerId || null;
    } catch (error) {

        return null;
    }
};

/**
 * Get seller ID from backend (for auth)
 */
export const getSellerId = async (email, uid, displayName, photoURL, idToken) => {
    // Check cache first
    const cacheKey = email?.toLowerCase()?.trim();
    if (cacheKey && sellerIdCache.has(cacheKey)) {

        return sellerIdCache.get(cacheKey);
    }

    // Check if request is already in progress
    if (cacheKey && sellerIdInProgress.has(cacheKey)) {

        // Wait for the in-progress request to complete
        while (sellerIdInProgress.has(cacheKey)) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        // Now check cache again
        if (sellerIdCache.has(cacheKey)) {
            return sellerIdCache.get(cacheKey);
        }
    }

    // Mark as in progress
    if (cacheKey) {
        sellerIdInProgress.add(cacheKey);
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

    try {
        const xsrfToken = getCookie('XSRF-TOKEN');
        const headers = {
            'Content-Type': 'application/json',
            ...(xsrfToken && { 'x-xsrf-token': xsrfToken })
        };

        if (idToken) {
            headers['Authorization'] = `Bearer ${idToken}`;
        }

        const response = await fetch(`${API_BASE_URL}/auth/seller`, {
            method: 'POST',
            headers: headers,
            credentials: 'include',
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
                const result = { success: true, sellerId: data.seller._id, seller: data.seller, userType: 'seller' };
                // Cache the result
                if (cacheKey) {
                    sellerIdCache.set(cacheKey, result);
                    sellerIdInProgress.delete(cacheKey);
                }
                return result;
            }
        }

        const errorData = await response.json().catch(() => ({}));
        const result = {
            success: false,
            error: errorData.message || 'Failed to get seller ID',
            status: response.status
        };
        // Cache the error result too to prevent repeated failed calls
        if (cacheKey) {
            sellerIdCache.set(cacheKey, result);
            sellerIdInProgress.delete(cacheKey);
        }
        return result;
    } catch (error) {
        clearTimeout(timeoutId);

        let result;
        if (error.name === 'AbortError') {
            result = { success: false, error: 'Request timeout. Please check your connection and try again.', status: 408 };
        } else {
            result = { success: false, error: error.message };
        }

        // Cache the error result and clean up
        if (cacheKey) {
            sellerIdCache.set(cacheKey, result);
            sellerIdInProgress.delete(cacheKey);
        }

        return result;
    }
};

export const updateSellerProfile = async (profile) => {

    // Make sure we have sellerId for authentication
    const authStore = localStorage.getItem('auth');
    if (!authStore) {

        return { success: false, error: 'Not authenticated. Please log in again.' };
    }

    let sellerId;
    try {
        const authData = JSON.parse(authStore);
        sellerId = authData.sellerId || authData.currentUser?.sellerId || authData.currentUser?._id;

    } catch (e) {

        return { success: false, error: 'Invalid authentication data' };
    }

    if (!sellerId) {

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
        productBatches: '/sync/product-batches',
        orders: '/sync/orders',
        transactions: '/sync/transactions',
        purchaseOrders: '/sync/vendor-orders',
        categories: '/sync/categories',
        customerTransactions: '/sync/customers',
        dProducts: '/sync/d-products',
        targets: '/sync/targets'
    };

    const endpoint = endpointMap[storeName];
    if (!endpoint) {

        return { success: false, error: `Unknown store: ${storeName}` };
    }

    //(`[syncData] Items count: ${Array.isArray(items) ? items.length : 1}`);

    // Backend expects items array in body, sellerId comes from auth middleware
    const requestBody = {
        items: Array.isArray(items) ? items : [items]
    };

    // Only include sellerId if explicitly provided (for backward compatibility)
    // But normally sellerId comes from auth middleware via x-seller-id header
    if (sellerId) {
        requestBody.sellerId = sellerId;
    }

    //(`[syncData] Request body:`, JSON.stringify(requestBody, null, 2));

    const result = await apiRequest(endpoint, {
        method: 'POST',
        body: requestBody
    });

    return result;
};

/**
 * Create order directly on backend (immediate sync)
 */
export const createOrder = async (order) => {
    try {

        //('📤 [createOrder] Order data:', JSON.stringify(order, null, 2));

        // Get sellerId from auth to ensure it's available
        const sellerId = getSellerIdFromAuth();

        if (!sellerId) {

            return {
                success: false,
                error: 'No sellerId found. Please login again.'
            };
        }

        const result = await syncData('orders', order, sellerId);

        if (result.success && result.data) {
            // Check response format - backend returns { success: true, results: { success: [...], failed: [...] } }
            const results = result.data.results || result.data;
            const successItems = results.success || [];

            if (successItems.length > 0) {
                const syncedOrder = successItems.find(item => item.id === order.id) || successItems[0];

                return {
                    success: true,
                    _id: syncedOrder._id,
                    order: syncedOrder,
                    action: syncedOrder.action || 'created'
                };
            } else {

                return {
                    success: false,
                    error: result.data.message || 'Order creation failed - no success response'
                };
            }
        } else {

            return {
                success: false,
                error: result.error || result.data?.message || 'Order creation failed'
            };
        }
    } catch (error) {

        return {
            success: false,
            error: error.message || 'Failed to create order'
        };
    }
};

export const registerSeller = async (registrationData) => {

    try {
        const xsrfToken = getCookie('XSRF-TOKEN');
        const headers = {
            'Content-Type': 'application/json',
            ...(xsrfToken && { 'x-xsrf-token': xsrfToken })
        };

        const response = await fetch(`${API_BASE_URL}/auth/seller/register`, {
            method: 'POST',
            headers: headers,
            credentials: 'include',
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

        return { success: false, error: error.message };
    }
};

// Clear seller ID cache (useful for testing or when switching users)
export const clearSellerIdCache = () => {
    sellerIdCache.clear();
    sellerIdInProgress.clear();

};

// Online Store API methods
export const getOnlineStoreSettings = async () => {
    return apiRequest('/online-store/settings');
};

export const updateOnlineStoreSettings = async (settings) => {
    return apiRequest('/online-store/settings', {
        method: 'PUT',
        body: settings
    });
};

export const getOnlineOrders = async (params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return apiRequest(`/online-store/orders?${queryParams}`);
};

export const updateOnlineOrderStatus = async (orderId, status) => {
    return apiRequest(`/online-store/orders/${orderId}/status`, {
        method: 'PUT',
        body: { status }
    });
};

export const verifyOnlineOrderDelivery = async (orderId, token) => {
    return apiRequest(`/online-store/orders/${orderId}/verify-delivery`, {
        method: 'PUT',
        body: { token }
    });
};

export const getOnlineDashboardStats = async () => {
    return apiRequest('/online-store/dashboard-stats');
};


export default {
    API_BASE_URL,
    apiRequest,
    getSellerId,
    registerSeller,
    syncData,
    networkAwareApiRequest,
    clearSellerIdCache,
    updateSellerProfile,
    createOrder,
    getOnlineStoreSettings,
    updateOnlineStoreSettings,
    getOnlineOrders,
    updateOnlineOrderStatus,
    verifyOnlineOrderDelivery,
    getOnlineDashboardStats
};
