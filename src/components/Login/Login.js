import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../../utils/firebase';
import { getSellerId, getStaffAuth, API_BASE_URL } from '../../utils/api';
import { saveStaffPermissions } from '../../utils/indexedDB';
import { Shield, TrendingUp, ArrowRight, CreditCard } from 'lucide-react';

// Global flag to prevent multiple API calls across component instances
let authAPICalled = false;

// Wrapper function to prevent multiple auth API calls
const safeGetStaffAuth = async (...args) => {
  if (authAPICalled) {
    console.log('🔄 Skipping getStaffAuth - auth API already called');
    return { success: false, error: 'Auth API already called' };
  }
  console.log('✅ Calling getStaffAuth (first time)');
  return await getStaffAuth(...args);
};

const safeGetSellerId = async (...args) => {
  if (authAPICalled) {
    console.log('🔄 Skipping getSellerId - auth API already called');
    return { success: false, error: 'Auth API already called' };
  }
  authAPICalled = true;
  console.log('✅ Calling getSellerId (first time)');
  return await getSellerId(...args);
};

const Login = () => {
  const { dispatch, state } = useApp();
  const navigate = useNavigate();
  const logoSrc = `${process.env.PUBLIC_URL || ''}/assets/drag-and-drop-logo.jpg`;
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isSigningInRef = useRef(false);
  const [showTerms, setShowTerms] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [isLoadingStaffPermissions, setIsLoadingStaffPermissions] = useState(false);

  // Check for redirect result on mount
  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
          const user = result.user;
          
          // Try to authenticate as staff first (since invited users are more likely to be staff)
          // If staff auth fails, try seller auth
          try {
            console.log('🔐 ATTEMPTING AUTHENTICATION FOR:', user.email);
            console.log('📧 Email:', user.email);
            console.log('🆔 UID:', user.uid);
            console.log('👤 Display Name:', user.displayName);

            // Intelligent authentication: Check all possible user types
            console.log('🔍 STARTING INTELLIGENT AUTHENTICATION');

            // Step 1: Try staff authentication first (existing staff)
            console.log('👤 STEP 1: ABOUT TO CALL getStaffAuth');
            let authResult;
            try {
              console.log('📞 Calling getStaffAuth with params:', {
                email: user.email,
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL
              });

              authResult = await safeGetStaffAuth(
                user.email,
                user.uid,
                user.displayName,
                user.photoURL
              );

              console.log('📋 STAFF AUTH RESULT RECEIVED:', authResult);
            } catch (staffError) {
              console.error('💥 STAFF AUTH THREW EXCEPTION:', staffError);
              authResult = { success: false, error: `Staff auth exception: ${staffError.message}` };
            }

            let userType = 'staff';

            if (authResult.success) {
              console.log('✅ STAFF AUTH SUCCESS - LOGGING IN AS STAFF');
            } else {
              console.log('❌ STAFF AUTH FAILED - TRYING SELLER AUTH');
              console.log('Staff auth error:', authResult.error);

              // Step 2: Try seller authentication
              console.log('🏪 STEP 2: ABOUT TO CALL getSellerId');
              try {
                authResult = await safeGetSellerId(
                  user.email,
                  user.uid,
                  user.displayName,
                  user.photoURL
                );
                console.log('📋 SELLER AUTH RESULT RECEIVED:', authResult);
                userType = 'seller';

                if (authResult.success) {
                  console.log('✅ SELLER AUTH SUCCESS - LOGGING IN AS EXISTING SELLER');
                } else {
                  console.log('❌ SELLER AUTH FAILED - NO EXISTING ACCOUNT FOUND');
                  console.log('Seller auth error:', authResult.error);

                  // Step 3: If neither staff nor seller, auto-register as seller
                  console.log('📝 STEP 3: USER IS NEITHER STAFF NOR SELLER - AUTO-REGISTERING AS SELLER');
                  try {
                    console.log('🔄 CALLING SELLER REGISTRATION API');
                    const emailPrefix = user.email.split('@')[0];
                    const registrationData = {
                      email: user.email,
                      uid: user.uid,
                      displayName: user.displayName,
                      photoURL: user.photoURL,
                      name: user.displayName || emailPrefix,
                      phoneNumber: '', // Default empty
                      shopName: `${user.displayName || emailPrefix}'s Store`, // Default shop name
                      businessAddress: '', // Default empty
                      city: '', // Default empty
                      state: '', // Default empty
                      pincode: '', // Default empty
                      gstNumber: '', // Default empty
                      businessType: 'Retail', // Default
                      lowStockThreshold: 10, // Default
                      expiryDaysThreshold: 7 // Default
                    };

                    const registerResult = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/auth/seller/register`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(registrationData)
                    });

                    if (registerResult.ok) {
                      const sellerData = await registerResult.json();
                      console.log('✅ SELLER AUTO-REGISTRATION SUCCESSFUL:', sellerData);
                      const authData = {
                        sellerId: sellerData.seller._id,
                        seller: sellerData.seller,
                        userType: 'seller',
                        loginTime: new Date().toISOString()
                      };
                      localStorage.setItem('auth', JSON.stringify(authData));
                      dispatch({
                        type: 'LOGIN',
                        payload: {
                          currentUser: sellerData.seller,
                          sellerId: sellerData.seller._id,
                          userType: 'seller'
                        }
                      });

                      // Store plan details immediately for offline access
                      console.log('🎯 SELLER LOGIN: About to process plan details:', sellerData.planDetails);
                      if (sellerData.planDetails) {
                        console.log('✅ SELLER LOGIN: Plan details found, setting in state');
                        dispatch({
                          type: ActionTypes.SET_CURRENT_PLAN_DETAILS,
                          payload: sellerData.planDetails
                        });
                        if (sellerData.planDetails.planId) {
                          dispatch({
                            type: ActionTypes.SET_CURRENT_PLAN,
                            payload: sellerData.planDetails.planId
                          });
                        }
                        if (typeof sellerData.planDetails.isExpired === 'boolean') {
                          dispatch({
                            type: ActionTypes.SET_SUBSCRIPTION_ACTIVE,
                            payload: !sellerData.planDetails.isExpired
                          });
                        }

                        // Cache plan details to IndexedDB for instant loading on refresh
                        const { updateInIndexedDB, STORES } = await import('../../utils/indexedDB');
                        const recordId = `planDetails_${sellerData.seller._id}`;
                        const record = {
                          id: recordId,
                          sellerId: sellerData.seller._id,
                          data: sellerData.planDetails,
                          lastUpdated: new Date().toISOString()
                        };

                        try {
                          await updateInIndexedDB(STORES.planDetails, record);
                          console.log('✅ Plan details cached during seller login');
                        } catch (cacheError) {
                          console.error('❌ Failed to cache plan details during seller login:', cacheError);
                        }
                      }

                      navigate('/dashboard', { state: { message: 'Welcome! Your seller account has been created automatically.', isNewRegistration: true } });
                      return;
                    } else {
                      console.error('❌ SELLER AUTO-REGISTRATION FAILED');
                      const errorData = await registerResult.json().catch(() => ({}));
                      setError(`Registration failed: ${errorData.message || 'Unknown error'}`);
                      auth.signOut().catch(console.error);
                      return;
                    }
                  } catch (registrationError) {
                    console.error('💥 REGISTRATION EXCEPTION:', registrationError);
                    setError('Failed to create seller account. Please try again.');
                    auth.signOut().catch(console.error);
                    return;
                  }
                }
              } catch (sellerError) {
                console.error('💥 SELLER AUTH THREW EXCEPTION:', sellerError);
                setError('Authentication failed due to technical error. Please try again.');
                auth.signOut().catch(console.error);
                return;
              }
            }

            if (authResult.success) {
              console.log(`✅ ${userType === 'seller' ? 'Seller' : 'Staff'} received from backend:`, authResult[userType]);
              console.log('🔍 Full authResult for debugging:', authResult);

              const loginPayload = {
                // Firebase user data
                username: user.displayName || user.email || 'User',
                photoURL: user.photoURL,
                uid: user.uid,

                // User type
                userType,

                // ALL user data from backend
                ...(authResult[userType]),

                // Additional data for staff - use seller._id as sellerId
                ...(userType === 'staff' && {
                  sellerId: authResult.seller?._id || authResult.sellerId,
                  seller: authResult.seller
                })
              };

              console.log('📤 Dispatching LOGIN with payload:', loginPayload);
              console.log('  - userType:', loginPayload.userType);
              console.log('  - name:', loginPayload.name);
              if (userType === 'seller') {
                console.log('  - shopName:', loginPayload.shopName);
                console.log('  - phoneNumber:', loginPayload.phoneNumber);
                console.log('  - city:', loginPayload.city);
              } else if (userType === 'staff') {
                console.log('  - sellerId:', loginPayload.sellerId);
                console.log('  - seller:', loginPayload.seller);
                console.log('  - authResult.seller:', authResult.seller);
                console.log('  - authResult.seller._id:', authResult.seller?._id);
                console.log('  ✅ Staff will access seller data using sellerId:', loginPayload.sellerId);
              } else if (userType === 'staff') {
                console.log('  - sellerId:', loginPayload.sellerId);
                console.log('  - permissions:', loginPayload.permissions);
              }

              try {
                dispatch({
                  type: 'LOGIN',
                  payload: loginPayload
                });
                console.log('✅ LOGIN action dispatched successfully');

                // Navigate to dashboard
                console.log(`🏠 Navigating ${userType} to dashboard`);
                navigate('/dashboard');
              } catch (dispatchError) {
                console.error('💥 Error dispatching LOGIN:', dispatchError);
                setError('Login failed due to technical error. Please try again.');
                auth.signOut().catch(console.error);
                return;
              }
            } else if (authResult.status === 403) {
              // Account inactive - deny access
              console.warn('Access denied: Account is inactive');
              setError(authResult.error || 'Your account has been deactivated. Please contact administrator.');
              auth.signOut().catch(console.error);
            } else if (authResult.status === 503) {
              // Database connection unavailable
              console.error('Database connection unavailable');
              setError(authResult.error || 'Database connection unavailable. Please try again later.');
              auth.signOut().catch(console.error);
            } else {
              // Other errors - deny access for security
              console.error('Backend verification failed:', authResult.error);

              // Provide better error messages based on the last auth attempt
              let errorMessage = 'Unable to verify your account. Please try again or contact support.';

              if (authResult.error?.includes('Seller account not found')) {
                errorMessage = 'Authentication failed. Please try again or contact support.';
              } else if (authResult.error?.includes('Staff account not found')) {
                errorMessage = 'Staff account not found or inactive. Please ensure you have completed the signup process using the invite link from your seller. If the issue persists, contact your seller.';
              } else if (authResult.error?.includes('Seller account is inactive')) {
                errorMessage = 'Your seller account has been deactivated. Please contact your seller or administrator.';
              }

              setError(errorMessage);
              auth.signOut().catch(console.error);
            }
          } catch (authError) {
            // Backend unavailable - deny access for security
            console.error('Backend auth error:', authError);
            auth.signOut().catch(console.error);
          }
        }
      } catch (error) {
        console.error('Error checking redirect result:', error);
      }
    };
    
    checkRedirectResult();
  }, [dispatch]);

  const handleGoogleSignIn = async () => {
    // Prevent multiple simultaneous sign-in attempts
    if (isLoading || isSigningInRef.current) {
      return;
    }

    try {
      isSigningInRef.current = true;
      setIsLoading(true);
      setError('');
      
      // Ensure auth instance is ready
      if (!auth || !googleProvider) {
        throw new Error('Firebase authentication is not properly initialized');
      }
      
      // Wait for auth to be ready before attempting sign-in
      try {
        await auth.authStateReady();
      } catch (readyError) {
        console.warn('Auth state ready warning:', readyError);
        // Continue anyway, auth might still work
      }
      
      // Use a timeout to prevent hanging promises
      const signInPromise = signInWithPopup(auth, googleProvider);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Sign-in timeout')), 60000) // Increased to 60 seconds
      );
      
      const result = await Promise.race([signInPromise, timeoutPromise]);
      const user = result.user;
      
      // Intelligent authentication: Check all possible user types
      console.log('🔍 STARTING GOOGLE SIGN-IN AUTHENTICATION');

      // Step 1: Check if user is staff
      console.log('👤 STEP 1: CHECKING IF USER IS STAFF');
      let authResult;
      let userType = 'unknown';

      try {
        authResult = await getStaffAuth(
          user.email,
          user.uid,
          user.displayName,
          user.photoURL
        );

        console.log('📋 STAFF AUTH RESULT:', authResult);

        if (authResult.success) {
          console.log('✅ USER IS STAFF - LOGGING IN');
          userType = 'staff';

          console.log('👤 Staff user detected from Google sign-in - checking permissions before navigation');

          const loginPayload = {
            // Firebase user data
            username: user.displayName || user.email || 'User',
            photoURL: user.photoURL,
            uid: user.uid,

            // User type
            userType: 'staff',

            // Staff data from backend
            ...authResult.staff,

            // Additional data for staff - use seller._id as sellerId
            sellerId: authResult.seller?._id || authResult.sellerId,
            seller: authResult.seller
          };

          // Save staff permissions to IndexedDB for offline access
          if (authResult.staff.permissions) {
            try {
              console.log('💾 Saving staff permissions to IndexedDB for offline access');
              await saveStaffPermissions(
                authResult.staff._id,
                authResult.staff.permissions,
                authResult.seller?._id || authResult.sellerId
              );
              console.log('✅ Staff permissions saved to IndexedDB');
            } catch (error) {
              console.error('❌ Failed to save staff permissions to IndexedDB:', error);
              // Don't block login if IndexedDB save fails
            }
          }

          // Check if we need to load permissions
          const hasPermissionsInPayload = authResult.staff.permissions && Object.keys(authResult.staff.permissions).length > 0;
          const needsPermissionRefresh = !hasPermissionsInPayload;

          if (needsPermissionRefresh) {
            console.log('🔄 Staff permissions not available - showing loading screen');
            setIsLoadingStaffPermissions(true);

            // Store basic auth data first
            const authData = {
              sellerId: authResult.sellerId,
              seller: authResult.seller,
              userType: 'staff',
              loginTime: new Date().toISOString()
            };
            localStorage.setItem('auth', JSON.stringify(authData));

            // Dispatch login first to set user state
            dispatch({
              type: 'LOGIN',
              payload: loginPayload
            });

            // Load permissions in background
            try {
              const { refreshStaffPermissions } = await import('../../utils/api');
              const freshPermissions = await refreshStaffPermissions();

              if (freshPermissions) {
                console.log('✅ Fresh permissions loaded:', freshPermissions);
                // Update the login payload with fresh permissions
                const updatedPayload = {
                  ...loginPayload,
                  permissions: freshPermissions
                };
                dispatch({
                  type: 'LOGIN',
                  payload: updatedPayload
                });
              } else {
                console.warn('⚠️ Failed to load fresh permissions, proceeding with available permissions');
              }
            } catch (permError) {
              console.error('❌ Error loading staff permissions:', permError);
            } finally {
              setIsLoadingStaffPermissions(false);
              console.log('🏠 Navigating staff to dashboard after permission check');
              navigate('/dashboard');
            }
          } else {
            console.log('✅ Staff permissions available - proceeding to dashboard');

            // Store auth data
            const authData = {
              sellerId: authResult.sellerId,
              seller: authResult.seller,
              userType: 'staff',
              loginTime: new Date().toISOString()
            };
            localStorage.setItem('auth', JSON.stringify(authData));

            // Dispatch login action
            dispatch({
              type: 'LOGIN',
              payload: loginPayload
            });

            // Navigate to dashboard
            navigate('/dashboard');
          }
          return;
        }
      } catch (staffError) {
        console.error('💥 STAFF AUTH EXCEPTION:', staffError);
      }

      // Step 2: If not staff, check if user is seller
      console.log('🏪 STEP 2: CHECKING IF USER IS SELLER (not staff)');
      try {
        authResult = await safeGetSellerId(
          user.email,
          user.uid,
          user.displayName,
          user.photoURL
        );

        console.log('📋 SELLER AUTH RESULT:', authResult);

        if (authResult.success) {
          console.log('✅ USER IS SELLER - LOGGING IN');

          // Check if this is a new seller account
          if (authResult.isNewSeller) {
            console.log('🆕 NEW SELLER ACCOUNT CREATED - REDIRECTING TO DASHBOARD WITH WELCOME');

            // Store auth data
            const authData = {
              sellerId: authResult.sellerId,
              seller: authResult.seller,
              userType: 'seller',
              loginTime: new Date().toISOString()
            };
            localStorage.setItem('auth', JSON.stringify(authData));

            // Dispatch login action
            dispatch({
              type: 'LOGIN',
              payload: {
                currentUser: authResult.seller,
                sellerId: authResult.sellerId,
                userType: 'seller'
              }
            });

            // Navigate to dashboard with welcome message for new sellers
            navigate('/dashboard', {
              state: {
                message: 'Welcome! Your seller account has been created automatically.',
                isNewRegistration: true
              }
            });
            return;
          } else {
            console.log('👤 EXISTING SELLER - NORMAL LOGIN');

            // Store auth data
            const authData = {
              sellerId: authResult.sellerId,
              seller: authResult.seller,
              userType: 'seller',
              loginTime: new Date().toISOString()
            };
            localStorage.setItem('auth', JSON.stringify(authData));

            // Dispatch login action
            dispatch({
              type: 'LOGIN',
              payload: {
                currentUser: authResult.seller,
                sellerId: authResult.sellerId,
                userType: 'seller'
              }
            });

            // Navigate to dashboard
            navigate('/dashboard');
            return;
          }
        }
      } catch (sellerError) {
        console.error('💥 SELLER AUTH EXCEPTION:', sellerError);
      }

      // Step 3: If neither staff nor seller, auto-register as seller
      console.log('📝 STEP 3: USER IS NEITHER STAFF NOR SELLER - AUTO-REGISTERING AS SELLER');

      try {
        console.log('🔄 CALLING SELLER REGISTRATION API');
        const registrationData = {
          email: user.email,
          uid: user.uid,
          displayName: user.displayName,
          photoURL: user.photoURL,
          name: user.displayName || user.email.split('@')[0],
          phoneNumber: '',
          shopName: `${user.displayName || user.email.split('@')[0]}'s Store`,
          businessAddress: '',
          city: '',
          state: '',
          pincode: '',
          gstNumber: '',
          businessType: 'Retail',
          lowStockThreshold: 10,
          expiryDaysThreshold: 7
        };

        const registerResult = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/auth/seller/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(registrationData)
        });

        if (registerResult.ok) {
          const sellerData = await registerResult.json();
          console.log('✅ SELLER AUTO-REGISTRATION SUCCESSFUL:', sellerData);

          // Store auth data
          const authData = {
            sellerId: sellerData.seller._id,
            seller: sellerData.seller,
            userType: 'seller',
            loginTime: new Date().toISOString()
          };
          localStorage.setItem('auth', JSON.stringify(authData));

          // Dispatch login action
          dispatch({
            type: 'LOGIN',
            payload: {
              currentUser: sellerData.seller,
              sellerId: sellerData.seller._id,
              userType: 'seller'
            }
          });

          // Store plan details immediately for offline access
          if (sellerData.planDetails) {
            dispatch({
              type: ActionTypes.SET_CURRENT_PLAN_DETAILS,
              payload: sellerData.planDetails
            });
            if (sellerData.planDetails.planId) {
              dispatch({
                type: ActionTypes.SET_CURRENT_PLAN,
                payload: sellerData.planDetails.planId
              });
            }
            if (typeof sellerData.planDetails.isExpired === 'boolean') {
              dispatch({
                type: ActionTypes.SET_SUBSCRIPTION_ACTIVE,
                payload: !sellerData.planDetails.isExpired
              });
            }

            // Cache plan details to IndexedDB for instant loading on refresh
            const { updateInIndexedDB, STORES } = await import('../../utils/indexedDB');
            const recordId = `planDetails_${sellerData.seller._id}`;
            const record = {
              id: recordId,
              sellerId: sellerData.seller._id,
              data: sellerData.planDetails,
              lastUpdated: new Date().toISOString()
            };

            try {
              await updateInIndexedDB(STORES.planDetails, record);
              console.log('✅ Plan details cached during seller login');
            } catch (cacheError) {
              console.error('❌ Failed to cache plan details during seller login:', cacheError);
            }
          }

          // Navigate to dashboard with welcome message
          navigate('/dashboard', {
            state: {
              message: 'Welcome! Your seller account has been created automatically.',
              isNewRegistration: true
            }
          });
          return;
        } else {
          console.error('❌ SELLER AUTO-REGISTRATION FAILED');
          const errorData = await registerResult.json().catch(() => ({}));
          setError(`Registration failed: ${errorData.message || 'Unknown error'}`);
          auth.signOut().catch(console.error);
          return;
        }
      } catch (registrationError) {
        console.error('💥 REGISTRATION EXCEPTION:', registrationError);
        setError('Failed to create seller account. Please try again.');
        auth.signOut().catch(console.error);
        return;
      }
    } catch (error) {
      console.error('Google sign in error:', error);
      
      // Handle specific Firebase auth errors
      let errorMessage = 'Failed to sign in with Google';
      
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = 'Sign-in popup was closed. Please try again.';
      } else if (error.code === 'auth/popup-blocked') {
        errorMessage = 'Popup was blocked. Using redirect method instead...';
        // Fallback to redirect if popup is blocked
        try {
          await signInWithRedirect(auth, googleProvider);
          return; // Redirect will happen, component will unmount
        } catch (redirectError) {
          errorMessage = 'Failed to sign in. Please allow popups or try again.';
        }
      } else if (error.code === 'auth/cancelled-popup-request') {
        errorMessage = 'Only one popup request is allowed at a time. Please wait and try again.';
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        errorMessage = 'An account with this email already exists.';
      } else if (error.message === 'Sign-in timeout') {
        errorMessage = 'Sign-in took too long. Please try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      // Only reset ref after a delay to prevent immediate retry
      setTimeout(() => {
        isSigningInRef.current = false;
      }, 1000);
    }
  };

  // Check if user is already logged in
  useEffect(() => {
    let unsubscribe = null;
    let isMounted = true;
    
    // Wait for auth to be ready, then set up listener
    const setupAuthListener = async () => {
      try {
        // Wait for auth to initialize
        await auth.authStateReady();
        
        if (!isMounted) return;
        
        // Helper function to create/verify seller and dispatch login
        const handleUserLogin = async (user) => {
          if (!user) return;

          // Check if we should refresh permissions
          // Always refresh for staff users, or if this is a page load refresh
          const storedAuth = localStorage.getItem('auth');
          let shouldRefresh = false;

          if (storedAuth) {
            try {
              const authData = JSON.parse(storedAuth);
              const isStoredStaffUser = authData.currentUser?.userType === 'staff';
              shouldRefresh = isStoredStaffUser; // Always refresh for staff users
            } catch (e) {
              shouldRefresh = true; // Refresh if we can't parse stored auth
            }
          }

          const skipReauth = !shouldRefresh && state.isAuthenticated && state.currentUser && state.currentUser.email === user.email;

          if (skipReauth) {
            console.log('👤 User already authenticated with fresh permissions, skipping handleUserLogin');
            return;
          }

          if (shouldRefresh) {
            console.log('🔄 STAFF USER - REFRESHING PERMISSIONS FROM SERVER for:', user.email);
          }

          console.log('🔄 handleUserLogin called for user:', user.email, '- REFRESHING PERMISSIONS FROM SERVER');
          console.log('📋 Following intelligent authentication flow (staff first, then seller)');

          // Follow the same intelligent authentication flow as handleGoogleSignIn
          try {
            console.log('🔐 INTELLIGENT AUTHENTICATION IN handleUserLogin');
            console.log('📧 Email:', user.email);
            console.log('🆔 UID:', user.uid);

            // Step 1: Try staff authentication first (existing staff)
            console.log('👤 STEP 1: Checking for existing staff account...');
            let authResult;
            try {
              authResult = await safeGetStaffAuth(
                user.email,
                user.uid,
                user.displayName,
                user.photoURL
              );
              console.log('📋 STAFF AUTH RESULT RECEIVED:', authResult);
            } catch (staffError) {
              console.error('💥 STAFF AUTH THREW EXCEPTION:', staffError);
              authResult = { success: false, error: `Staff auth exception: ${staffError.message}` };
            }

            let userType = 'staff';

            if (authResult.success) {
              console.log('✅ STAFF AUTH SUCCESS - LOGGING IN AS STAFF');
            } else {
              console.log('❌ STAFF AUTH FAILED - TRYING SELLER AUTH');
              console.log('Staff auth error:', authResult.error);

              // Step 2: Try seller authentication
              try {
                authResult = await safeGetSellerId(
                  user.email,
                  user.uid,
                  user.displayName,
                  user.photoURL
                );
                console.log('📋 SELLER AUTH RESULT RECEIVED:', authResult);
                userType = 'seller';

                if (authResult.success) {
                  console.log('✅ SELLER AUTH SUCCESS - LOGGING IN AS EXISTING SELLER');
                } else {
                  console.log('❌ SELLER AUTH FAILED - NO EXISTING ACCOUNT FOUND');
                  console.log('Seller auth error:', authResult.error);

                  // Step 3: If neither staff nor seller, auto-register as seller
                  console.log('📝 STEP 3: USER IS NEITHER STAFF NOR SELLER - AUTO-REGISTERING AS SELLER');
                  try {
                    console.log('🔄 CALLING SELLER REGISTRATION API');
                    const emailPrefix = user.email.split('@')[0];
                    const registrationData = {
                      email: user.email,
                      uid: user.uid,
                      displayName: user.displayName,
                      photoURL: user.photoURL,
                      name: user.displayName || emailPrefix,
                      phoneNumber: '', // Default empty
                      shopName: `${user.displayName || emailPrefix}'s Store`, // Default shop name
                      businessAddress: '', // Default empty
                      city: '', // Default empty
                      state: '', // Default empty
                      pincode: '', // Default empty
                      gstNumber: '', // Default empty
                      businessType: 'Retail', // Default
                      lowStockThreshold: 10, // Default
                      expiryDaysThreshold: 7 // Default
                    };

                    const registerResult = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/auth/seller/register`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(registrationData)
                    });

                    if (registerResult.ok) {
                      const sellerData = await registerResult.json();
                      console.log('✅ SELLER AUTO-REGISTRATION SUCCESSFUL:', sellerData);
                      const authData = {
                        sellerId: sellerData.seller._id,
                        seller: sellerData.seller,
                        userType: 'seller',
                        loginTime: new Date().toISOString()
                      };
                      localStorage.setItem('auth', JSON.stringify(authData));
                      dispatch({
                        type: 'LOGIN',
                        payload: {
                          currentUser: sellerData.seller,
                          sellerId: sellerData.seller._id,
                          userType: 'seller'
                        }
                      });

                      // Store plan details immediately for offline access
                      console.log('🎯 SELLER LOGIN: About to process plan details:', sellerData.planDetails);
                      if (sellerData.planDetails) {
                        console.log('✅ SELLER LOGIN: Plan details found, setting in state');
                        dispatch({
                          type: ActionTypes.SET_CURRENT_PLAN_DETAILS,
                          payload: sellerData.planDetails
                        });
                        if (sellerData.planDetails.planId) {
                          dispatch({
                            type: ActionTypes.SET_CURRENT_PLAN,
                            payload: sellerData.planDetails.planId
                          });
                        }
                        if (typeof sellerData.planDetails.isExpired === 'boolean') {
                          dispatch({
                            type: ActionTypes.SET_SUBSCRIPTION_ACTIVE,
                            payload: !sellerData.planDetails.isExpired
                          });
                        }

                        // Cache plan details to IndexedDB for instant loading on refresh
                        const { updateInIndexedDB, STORES } = await import('../../utils/indexedDB');
                        const recordId = `planDetails_${sellerData.seller._id}`;
                        const record = {
                          id: recordId,
                          sellerId: sellerData.seller._id,
                          data: sellerData.planDetails,
                          lastUpdated: new Date().toISOString()
                        };

                        try {
                          await updateInIndexedDB(STORES.planDetails, record);
                          console.log('✅ Plan details cached during seller login');
                        } catch (cacheError) {
                          console.error('❌ Failed to cache plan details during seller login:', cacheError);
                        }
                      }

                      navigate('/dashboard', { state: { message: 'Welcome! Your seller account has been created automatically.', isNewRegistration: true } });
                      return;
                    } else {
                      console.error('❌ SELLER AUTO-REGISTRATION FAILED');
                      const errorData = await registerResult.json().catch(() => ({}));
                      setError(`Registration failed: ${errorData.message || 'Unknown error'}`);
                      auth.signOut().catch(console.error);
                      return;
                    }
                  } catch (registrationError) {
                    console.error('💥 REGISTRATION EXCEPTION:', registrationError);
                    setError('Failed to create seller account. Please try again.');
                    auth.signOut().catch(console.error);
                    return;
                  }
                }
              } catch (sellerError) {
                console.error('💥 SELLER AUTH THREW EXCEPTION:', sellerError);
                setError('Authentication failed due to technical error. Please try again.');
                auth.signOut().catch(console.error);
                return;
              }
            }

            if (authResult.success) {
              console.log(`✅ ${userType === 'seller' ? 'Seller' : 'Staff'} received from backend:`, authResult[userType]);
              if (userType === 'seller') {
                console.log('🔍 Seller profileCompleted status:', authResult.seller?.profileCompleted);
                console.log('🔍 Seller data keys:', Object.keys(authResult.seller || {}));
              }
              if (userType === 'staff') {
                console.log('🔄 STAFF PERMISSIONS REFRESHED FROM SERVER:', authResult.staff.permissions);
                console.log('🏪 Associated seller:', authResult.seller?.name);
              }
              console.log('🔍 Full authResult for debugging:', authResult);

              const loginPayload = {
                // Firebase user data
                username: user.displayName || user.email || 'User',
                photoURL: user.photoURL,
                uid: user.uid,

                // User type
                userType,

                // ALL user data from backend
                ...(authResult[userType]),

                // Additional data for staff - use seller._id as sellerId
                ...(userType === 'staff' && {
                  sellerId: authResult.seller?._id || authResult.sellerId,
                  seller: authResult.seller
                })
              };

              console.log('📤 Dispatching LOGIN with payload:', loginPayload);
              console.log('  - userType:', loginPayload.userType);
              console.log('  - name:', loginPayload.name);
              if (userType === 'seller') {
                console.log('  - shopName:', loginPayload.shopName);
                console.log('  - phoneNumber:', loginPayload.phoneNumber);
                console.log('  - city:', loginPayload.city);
              } else if (userType === 'staff') {
                console.log('  - sellerId:', loginPayload.sellerId);
                console.log('  - seller:', loginPayload.seller);
                console.log('  - authResult.seller:', authResult.seller);
                console.log('  - authResult.seller._id:', authResult.seller?._id);
                console.log('  ✅ Staff will access seller data using sellerId:', loginPayload.sellerId);
              } else if (userType === 'staff') {
                console.log('  - sellerId:', loginPayload.sellerId);
                console.log('  - permissions:', loginPayload.permissions);
              }

              // For staff users, check permissions before navigating
              if (userType === 'staff') {
                console.log('👤 Staff user detected - checking permissions before navigation');

                // Save staff permissions to IndexedDB for offline access
                if (authResult.staff.permissions) {
                  try {
                    console.log('💾 Saving staff permissions to IndexedDB for offline access');
                    await saveStaffPermissions(
                      authResult.staff._id,
                      authResult.staff.permissions,
                      authResult.seller?._id || authResult.sellerId
                    );
                    console.log('✅ Staff permissions saved to IndexedDB');
                  } catch (error) {
                    console.error('❌ Failed to save staff permissions to IndexedDB:', error);
                    // Don't block login if IndexedDB save fails
                  }
                }

                // Check if we need to load permissions
                const hasPermissionsInPayload = authResult.staff.permissions && Object.keys(authResult.staff.permissions).length > 0;
                const needsPermissionRefresh = !hasPermissionsInPayload;

                if (needsPermissionRefresh) {
                  console.log('🔄 Staff permissions not available - showing loading screen');
                  setIsLoadingStaffPermissions(true);

                  // Dispatch login first to set user state
                  dispatch({
                    type: 'LOGIN',
                    payload: loginPayload
                  });

                  // Load permissions in background
                  try {
                    const { refreshStaffPermissions } = await import('../../utils/api');
                    const freshPermissions = await refreshStaffPermissions();

                    if (freshPermissions) {
                      console.log('✅ Fresh permissions loaded:', freshPermissions);
                      // Update the login payload with fresh permissions
                      const updatedPayload = {
                        ...loginPayload,
                        permissions: freshPermissions
                      };
                      dispatch({
                        type: 'LOGIN',
                        payload: updatedPayload
                      });
                    } else {
                      console.warn('⚠️ Failed to load fresh permissions, proceeding with available permissions');
                    }
                  } catch (permError) {
                    console.error('❌ Error loading staff permissions:', permError);
                  } finally {
                    setIsLoadingStaffPermissions(false);
                    console.log('🏠 Navigating staff to dashboard after permission check');
                    navigate('/dashboard');
                  }
                } else {
                  console.log('✅ Staff permissions available - proceeding to dashboard');
                  dispatch({
                    type: 'LOGIN',
                    payload: loginPayload
                  });
                  navigate('/dashboard');
                }
              } else {
                // For seller users, proceed normally
                dispatch({
                  type: 'LOGIN',
                  payload: loginPayload
                });
                console.log(`🏠 Navigating ${userType} to dashboard`);
                navigate('/dashboard');
              }
            } else {
              console.log('❌ Authentication failed');
              console.log('Auth result error:', authResult.error);
              setError(authResult.error || 'Authentication failed. Please try again.');
              auth.signOut().catch(console.error);
            }
          } catch (error) {
            console.error('Error during intelligent authentication:', error);
            setError('Authentication failed. Please try again.');
            auth.signOut().catch(console.error);
          }
        };
        
        // Always check and refresh permissions for authenticated users
        // This ensures staff get fresh permissions on page refresh
        if (auth.currentUser) {
          console.log('🔄 PAGE LOAD - Checking authentication for:', auth.currentUser.email);
          await handleUserLogin(auth.currentUser);
        }

        // Set up listener for auth state changes
        unsubscribe = auth.onAuthStateChanged(async (user) => {
          if (!isMounted) return;

          if (user) {
            console.log('🔄 AUTH STATE CHANGE - Processing user:', user.email);
            await handleUserLogin(user);
          }
        });
      } catch (error) {
        console.error('Error setting up auth state listener:', error);
      }
    };
    
    setupAuthListener();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [dispatch]);

  const handleRazorpayDemoLogin = async () => {
    if (isLoadingDemo) return;

    try {
      setIsLoadingDemo(true);
      setError('');

      // Call demo account endpoint
      const response = await fetch(`${API_BASE_URL}/auth/demo/razorpay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (data.success && data.seller) {
        console.log('✅ Razorpay demo account logged in:', data.seller);
        
        const loginPayload = {
          username: 'Razorpay Demo Account',
          photoURL: null,
          uid: 'razorpay-demo-uid',
          ...data.seller,
          sellerId: data.seller._id
        };
        
        console.log('📤 Dispatching LOGIN with demo payload:', loginPayload);
        
        dispatch({ 
          type: 'LOGIN', 
          payload: loginPayload
        });
      } else {
        setError(data.message || 'Failed to create demo account. Please try again.');
      }
    } catch (err) {
      console.error('Razorpay demo login error:', err);
      setError('Failed to login to demo account. Please try again.');
    } finally {
      setIsLoadingDemo(false);
    }
  };

  // Show loading screen for staff permissions
  if (isLoadingStaffPermissions) {
    return (
      <div className="relative min-h-screen overflow-hidden flex items-center justify-center" style={{
        background: 'radial-gradient(circle at top left, rgba(242, 244, 255, 0.95), rgba(237, 241, 255, 0.9)), linear-gradient(135deg, #f8fafc 0%, #eef2ff 35%, #e2e8f0 100%)'
      }}>
        <div className="text-center">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 max-w-md mx-auto">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading Your Workspace</h2>
            <p className="text-gray-600">We are reading your permissions and setting up your dashboard...</p>
            <div className="mt-4 text-sm text-gray-500">
              Please wait while we prepare your personalized experience.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden" style={{
      background: 'radial-gradient(circle at top left, rgba(242, 244, 255, 0.95), rgba(237, 241, 255, 0.9)), linear-gradient(135deg, #f8fafc 0%, #eef2ff 35%, #e2e8f0 100%)'
    }}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-24 h-[40vh] w-[40vh] rounded-full bg-[#2F3C7E]/5 blur-3xl"></div>
        <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-white/50 blur-3xl"></div>
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col-reverse gap-8 px-0 pb-12 pt-8 sm:px-6 lg:flex-row lg:items-center lg:justify-center lg:gap-16 lg:px-8 lg:pb-14 lg:pt-12">
        <section className="flex flex-1 flex-col justify-center px-6 sm:px-0">
          <div className="mx-auto w-full max-w-xl space-y-8">
            <div className="space-y-6">
              <div>
                <h1 className="text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl sm:leading-tight">
                  All-in-one retail management platform
                </h1>
                <p className="mt-4 text-lg text-slate-600">
                  Billing, inventory, and analytics in one place. Start selling smarter today.
                </p>
              </div>

              <div className="space-y-4 pt-4">
                {[
                  {
                    icon: Shield,
                    title: 'Secure & Reliable',
                    body: 'Google-secured authentication with enterprise-grade security.',
                  },
                  {
                    icon: TrendingUp,
                    title: 'Real-time Analytics',
                    body: 'Live KPIs and insights to make data-driven decisions.',
                  },
                  {
                    icon: ArrowRight,
                    title: 'Works Offline',
                    body: 'Continue selling even when internet is down. Auto-syncs when back online.',
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(47, 60, 126, 0.08)', color: '#2F3C7E' }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900">{title}</p>
                      <p className="mt-1 text-sm text-slate-600">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-1 items-center justify-center">
          <div className="w-full sm:max-w-md rounded-2xl border border-[#2F3C7E]/20 bg-white p-8 sm:p-10 shadow-lg">
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-20 w-22 items-center justify-center rounded-2xl bg-transparent overflow-hidden">
                <img
                  src={logoSrc}
                  alt="Drag & Drop"
                  className="h-40 w-40 object-cover"
                  onError={(e) => { e.currentTarget.src = `${process.env.PUBLIC_URL || ''}/assets/drag-drop-logo.png`; }}
                />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
                <p className="mt-2 text-sm text-slate-500">Sign in to access your dashboard</p>
              </div>
            </div>

            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="btn-primary mt-8 w-full py-3.5 px-4 text-sm"
            >
              <span className="flex items-center justify-center gap-3">
                {isLoading ? (
                  <>
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                    <span>Signing in…</span>
                  </>
                ) : (
                  <>
                    <img
                      src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                      alt="Google logo"
                      className="h-5 w-5"
                    />
                    <span>Continue with Google</span>
                  </>
                )}
              </span>
            </button>

            {error && (
              <div className="mt-6 rounded-xl border border-rose-400/40 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {error}
              </div>
            )}

            {/* Razorpay Demo Account Button */}
            <button
              onClick={handleRazorpayDemoLogin}
              disabled={isLoadingDemo || isLoading}
              className="mt-4 w-full rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-orange-100 py-3 px-4 text-sm font-semibold text-orange-700 shadow-sm transition hover:from-orange-100 hover:to-orange-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center justify-center gap-2">
                {isLoadingDemo ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-700/20 border-t-orange-700"></div>
                    <span>Logging in...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    <span>Razorpay Demo Account</span>
                  </>
                )}
              </span>
            </button>

            <div className="mt-6 space-y-3 text-center">
              <p className="text-xs text-slate-400">
                Your credentials stay with Google. We never see or store your password.
              </p>
              <button
                type="button"
                onClick={() => setShowTerms(true)}
                className="text-xs font-medium transition hover:opacity-80"
                style={{ color: '#2F3C7E' }}
              >
                Terms &amp; Conditions
              </button>
            </div>
          </div>
        </section>
      </div>

      {showTerms && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="bg-white max-w-3xl w-full max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Drag & Drop Terms & Conditions</h2>
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                className="text-slate-500 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto space-y-4 text-sm text-slate-700 max-h-[70vh]">
              <p>
                These Terms & Conditions govern your use of the Drag & Drop inventory management platform. By
                authenticating, you agree to comply with the following policies designed for retailers managing
                inventory, billing, and customer data.
              </p>
              <ol className="list-decimal list-inside space-y-3">
                <li>
                  <strong>Account Responsibility.</strong> Each seller account is for a single business entity.
                  You are responsible for safeguarding login credentials and restricting access to authorized
                  team members only.
                </li>
                <li>
                  <strong>Data Accuracy.</strong> You agree to maintain accurate product, customer, and order
                  information. Inventory adjustments, returns, and write-offs should be recorded promptly to keep
                  analytics reliable.
                </li>
                <li>
                  <strong>Usage Limits & Plans.</strong> Plan quotas for customers, products, and orders are
                  enforced automatically. When limits are reached, Drag & Drop may pause record creation, prompt
                  you to upgrade, or stack an additional plan order, according to your configuration.
                </li>
                <li>
                  <strong>Billing & Payments.</strong> Paid plan charges are due in advance. Failed payments may
                  result in a downgrade or suspension until the balance is cleared. All fees are non-refundable
                  unless required by law.
                </li>
                <li>
                  <strong>Integrations & Automation.</strong> When enabling automations, webhooks, or third-party
                  integrations, you are responsible for configuration and any resulting actions (for example,
                  automated stock adjustments or notifications).
                </li>
                <li>
                  <strong>Compliance & Security.</strong> You must comply with applicable laws regarding taxes,
                  invoicing, and data privacy. Drag & Drop encrypts data in transit and at rest; however, you are
                  responsible for securing devices that access the platform.
                </li>
                <li>
                  <strong>Prohibited Conduct.</strong> You may not misuse the platform to store unlawful content,
                  interfere with system operations, or share access with competitors with the intent to reverse
                  engineer or benchmark proprietary features.
                </li>
                <li>
                  <strong>Data Retention.</strong> Inventory, billing, and activity data are retained for the
                  duration of your subscription. Upon cancellation, you may export records before the account is
                  closed. Drag & Drop may retain anonymized usage metrics for product improvement.
                </li>
                <li>
                  <strong>Service Modifications.</strong> We may add, change, or sunset features with reasonable
                  notice. Critical changes affecting plan limits or pricing will be communicated to account owners
                  via email or in-app announcements.
                </li>
                <li>
                  <strong>Termination.</strong> Drag & Drop reserves the right to suspend or terminate accounts
                  that violate these terms or present security risks. You may terminate at any time by contacting
                  support; outstanding invoices remain payable.
                </li>
              </ol>
              <p className="text-xs text-slate-500">
                By continuing to use Drag & Drop, you acknowledge that these Terms & Conditions may be updated from
                time to time. We will notify account owners of material changes. For questions, contact
                support@draganddrop.com.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
