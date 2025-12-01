import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { signInWithPopup, getRedirectResult } from 'firebase/auth';
import { auth, googleProvider } from '../../utils/firebase';
import { getSellerId } from '../../utils/api';
import { backgroundSyncWithBackend } from '../../utils/dataFetcher';

const Login = () => {
  const { dispatch, state } = useApp();
  const navigate = useNavigate();
  const logoSrc = `${process.env.PUBLIC_URL || ''}/assets/drag-and-drop-logo.jpg`;
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isSigningInRef = useRef(false);
  const isAuthenticatingRef = useRef(false); // Prevent duplicate authentication calls

  // Handle authentication for a user
  const handleUserAuthentication = async (user) => {
    console.log('🔍 ===== STARTING USER AUTHENTICATION =====');
    console.log('👤 User details:', {
      email: user.email,
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL
    });

    // Prevent duplicate authentication calls
    if (isAuthenticatingRef.current) {
      console.log('⚠️ Authentication already in progress, skipping duplicate call');
      return;
    }

    isAuthenticatingRef.current = true;

    if (!user || !user.email) {
      console.error('❌ Invalid user object');
      setError('Invalid user data received.');
      setIsLoading(false);
      return;
    }

    try {
      console.log('🏪 🔄 Attempting seller authentication...');
      // Try seller authentication
      const sellerAuthResult = await getSellerId(user.email);
      console.log('📋 Seller auth result:', sellerAuthResult);

      if (sellerAuthResult && sellerAuthResult.success) {
        console.log('✅ Proceeding with seller authentication');
        await proceedWithAuthentication(sellerAuthResult, 'seller', user);
      } else {
        console.log('❌ No seller account found for this email');
        setError('No account found for this email. Please register first or contact support.');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('❌ CRITICAL: Authentication error:', error);
      console.error('Error stack:', error.stack);
      setError(`Authentication failed: ${error.message}`);
      setIsLoading(false);
    } finally {
      isAuthenticatingRef.current = false; // Reset authentication flag
    }
  };

  const proceedWithAuthentication = async (authResult, userType, user) => {
    console.log('🎯 ===== PROCEEDING WITH AUTHENTICATION =====');
    console.log('👤 User type:', userType);
    console.log('📋 Auth result:', authResult);

    try {
      if (!authResult || !authResult.success) {
        throw new Error('Invalid authentication result');
      }

      const userData = authResult[userType];
      if (!userData) {
        throw new Error(`No ${userType} data found in auth result`);
      }

      console.log('👤 User data keys:', Object.keys(userData));
      console.log('📧 User email from Firebase:', user?.email);

      // For staff users, ensure sellerId is properly set from the seller object
      let sellerId = userData.sellerId;
      if (userType === 'staff' && authResult.seller?._id) {
        sellerId = authResult.seller._id;
        console.log('👤 Staff sellerId extracted from authResult.seller._id:', sellerId);
      }

      const payload = {
        ...userData,
        sellerId: sellerId, // Ensure sellerId is properly set
        userType: userType,
        email: user?.email || userData.email || '',
        uid: user?.uid || ''
      };

      console.log('📤 Final payload to dispatch:', payload);

      // Dispatch login action
      console.log('🔄 Dispatching LOGIN action...');
      dispatch({
        type: ActionTypes.LOGIN,
        payload: payload
      });

      console.log('✅ Login action dispatched successfully');

      // Verify the state was updated
      console.log('🔍 State after dispatch (should show user):', {
        isAuthenticated: state.isAuthenticated,
        currentUser: state.currentUser,
        userType: state.userType
      });

      // Trigger background sync to get fresh data from backend
      setTimeout(async () => {
        console.log('🔄 LOGIN: Triggering background sync after login...');
        try {
          // Ensure sellerId is available in localStorage before sync
          const verifyAuth = () => {
            try {
              const auth = localStorage.getItem('auth');
              if (auth) {
                const authData = JSON.parse(auth);
                return authData.sellerId || authData.currentUser?.sellerId;
              }
              return null;
            } catch (error) {
              console.error('Error verifying auth data:', error);
              return null;
            }
          };

          // Wait up to 2 seconds for sellerId to be available
          let attempts = 0;
          while (!verifyAuth() && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          }

          const currentSellerId = verifyAuth();
          if (!currentSellerId) {
            console.error('❌ LOGIN: Seller ID not available after waiting, skipping background sync');
          } else {
            console.log('✅ LOGIN: Seller ID verified, proceeding with background sync:', currentSellerId);
            const syncResult = await backgroundSyncWithBackend(dispatch, ActionTypes);
            if (syncResult.success) {
              console.log('✅ LOGIN: Background sync completed successfully after login');
              dispatch({
                type: ActionTypes.SET_DATA_FRESHNESS,
                payload: { freshness: 'fresh', lastSynced: Date.now() }
              });
            } else {
              console.log('⚠️ LOGIN: Background sync failed after login:', syncResult.reason);
            }
          }
        } catch (error) {
          console.error('❌ LOGIN: Background sync error after login:', error);
        }
      }, 1000);

      // Hide loading spinner before navigation
      console.log('🔄 Hiding loading spinner after successful authentication');
      setIsLoading(false);

      console.log('🏠 Navigating to dashboard...');

      // Add a small delay to ensure state updates propagate
      setTimeout(async () => {
        console.log('🚀 Executing navigation to /dashboard');
        console.log('📊 Current state after dispatch:', state);
        navigate('/dashboard', { replace: true });
        console.log('✅ Navigation executed');
      }, 200);

    } catch (error) {
      console.error('❌ CRITICAL: Error in proceedWithAuthentication:', error);
      console.error('Error stack:', error.stack);

      setError(`Authentication failed: ${error.message}`);
      setIsLoading(false);

      // Sign out user on critical failure
      try {
        await auth.signOut();
        console.log('👋 User signed out due to authentication failure');
      } catch (signOutError) {
        console.warn('⚠️ Failed to sign out user:', signOutError);
      }
    }
  };

  // Check for redirect result on mount
  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        console.log('🔄 Checking for Firebase redirect result...');
        const result = await getRedirectResult(auth);
        if (result && result.user) {
          console.log('🔄 REDIRECT RESULT DETECTED - processing authentication');
          // Check if authentication is already in progress
          if (!isAuthenticatingRef.current) {
            await handleUserAuthentication(result.user);
          } else {
            console.log('⚠️ Authentication already in progress from popup, skipping redirect result');
          }
        } else {
          console.log('ℹ️ No redirect result found');
        }
      } catch (error) {
        console.error('Error checking redirect result:', error);
      }
    };

    checkRedirectResult();
  }, []);

  // Safety timeout - if loading takes too long, show error
  useEffect(() => {
    if (!isLoading) return;

    const timeout = setTimeout(() => {
      console.error('⏰ AUTHENTICATION TIMEOUT - Loading took too long');
      setError('Authentication is taking too long. Please refresh the page and try again.');
      setIsLoading(false);
      isSigningInRef.current = false;
    }, 45000); // 45 seconds timeout

    return () => clearTimeout(timeout);
  }, [isLoading]);

  const handleGoogleSignIn = async () => {
    if (isLoading || isSigningInRef.current) {
      console.log('⚠️ Sign-in already in progress, ignoring');
      return;
    }

    console.log('🚀 ===== STARTING GOOGLE SIGN-IN PROCESS =====');

    try {
      isSigningInRef.current = true;
      setIsLoading(true);
      setError('');

      console.log('🔐 Initializing Firebase auth...');
      console.log('📡 API_BASE_URL:', process.env.REACT_APP_API_URL || 'http://localhost:5000');

      // Add timeout to detect hanging
      const signInPromise = signInWithPopup(auth, googleProvider);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sign-in timeout after 30 seconds')), 30000)
      );

      console.log('🔄 Waiting for user to select Google account...');
      const result = await Promise.race([signInPromise, timeoutPromise]);

      console.log('✅ Google sign-in successful:', result.user.email);
      console.log('🔄 Now proceeding to backend authentication...');

      // Add a small delay to ensure state updates
      await new Promise(resolve => setTimeout(resolve, 100));

      await handleUserAuthentication(result.user);

    } catch (error) {
      console.error('❌ CRITICAL: Google sign-in error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      // Handle specific Firebase auth errors
      if (error.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled. Please try again.');
      } else if (error.code === 'auth/popup-blocked') {
        setError('Sign-in popup was blocked. Please allow popups and try again.');
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        setError('An account with this email already exists. Please sign in with the existing method.');
      } else if (error.message === 'Sign-in timeout after 30 seconds') {
        setError('Sign-in took too long. Please try again.');
      } else {
        setError(`Sign-in failed: ${error.message || 'Unknown error'}`);
      }

      setIsLoading(false);
    } finally {
      isSigningInRef.current = false;
      console.log('🔚 ===== GOOGLE SIGN-IN PROCESS COMPLETE =====');
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden" style={{
      background: 'radial-gradient(circle at top left, rgba(242, 244, 255, 0.95), rgba(237, 241, 255, 0.9)), linear-gradient(135deg, #f8fafc 0%, #eef2ff 35%, #e2e8f0 100%)'
    }}>
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          {/* Logo */}
          <div className="mx-auto flex h-20 w-22 items-center justify-center rounded-2xl bg-transparent overflow-hidden">
                <img
                  src={logoSrc}
                  alt="Drag & Drop"
                  className="h-40 w-40 object-cover"
                  onError={(e) => { e.currentTarget.src = `${process.env.PUBLIC_URL || ''}/assets/drag-drop-logo.png`; }}
                />
              </div>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-3 leading-tight">Welcome Back</h1>
            <p className="text-gray-600 leading-relaxed">Sign in to your account</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm leading-relaxed">{error}</p>
            </div>
          )}

          {/* Sign In Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center px-6 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
                {isLoading ? (
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                <span className="text-gray-600 font-medium leading-relaxed">Signing in...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="h-5 w-5" />
                <span className="text-gray-700 font-semibold leading-relaxed">Continue with Google</span>
              </div>
            )}
          </button>

          <p className="mt-8 text-xs text-gray-500 leading-relaxed text-center max-w-sm">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>

    </div>
  );
};

export default Login;
