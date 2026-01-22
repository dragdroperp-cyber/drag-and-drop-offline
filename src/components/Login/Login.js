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
    // Prevent duplicate authentication calls
    if (isAuthenticatingRef.current) {
      return;
    }
    isAuthenticatingRef.current = true;
    if (!user || !user.email) {
      setError('Invalid user data received.');
      setIsLoading(false);
      return;
    }
    try {
      // Try seller authentication
      const idToken = await user.getIdToken();
      const sellerAuthResult = await getSellerId(user.email, user.uid, user.displayName, user.photoURL, idToken);
      if (sellerAuthResult && sellerAuthResult.success) {
        await proceedWithAuthentication(sellerAuthResult, 'seller', user);
      } else {
        setError('No account found for this email. Please register first or contact support.');
        setIsLoading(false);
      }
    } catch (error) {
      setError(`Authentication failed: ${error.message}`);
      setIsLoading(false);
    } finally {
      isAuthenticatingRef.current = false; // Reset authentication flag
    }
  };
  const proceedWithAuthentication = async (authResult, userType, user) => {
    try {
      if (!authResult || !authResult.success) {
        throw new Error('Invalid authentication result');
      }
      const userData = authResult[userType];
      if (!userData) {
        throw new Error(`No ${userType} data found in auth result`);
      }
      //('👤 User data keys:', Object.keys(userData));
      // For staff users, ensure sellerId is properly set from the seller object
      let sellerId = userData.sellerId;
      if (userType === 'staff' && authResult.seller?._id) {
        sellerId = authResult.seller._id;
      }
      const payload = {
        ...userData,
        sellerId: sellerId, // Ensure sellerId is properly set
        userType: userType,
        email: user?.email || userData.email || '',
        uid: user?.uid || ''
      };
      // Dispatch login action
      dispatch({
        type: ActionTypes.LOGIN,
        payload: payload
      });
      // Verify the state was updated
      console.log('🔍 State after dispatch (should show user):', {
        isAuthenticated: state.isAuthenticated,
        currentUser: state.currentUser,
        userType: state.userType
      });
      // Trigger background sync to get fresh data from backend
      // Trigger background sync to get fresh data from backend
      // DISABLED: AppContext.js already triggers loadData() when isAuthenticated becomes true.
      // This explicit call was causing a duplicate /data/all request.
      /*
      setTimeout(async () => {
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
          } else {
            const syncResult = await backgroundSyncWithBackend(dispatch, ActionTypes);
            if (syncResult.success) {
              // Mark that background sync was completed after login
              sessionStorage.setItem('backgroundSyncCompleted', Date.now().toString());
              dispatch({
                type: ActionTypes.SET_DATA_FRESHNESS,
                payload: { freshness: 'fresh', lastSynced: Date.now() }
              });
            } else {
            }
          }
        } catch (error) {
        }
      }, 1000);
      */
      // Hide loading spinner before navigation
      setIsLoading(false);
      // Add a small delay to ensure state updates propagate
      setTimeout(async () => {
        navigate('/dashboard', { replace: true });
      }, 200);
    } catch (error) {
      setError(`Authentication failed: ${error.message}`);
      setIsLoading(false);
      // Sign out user on critical failure
      try {
        await auth.signOut();
      } catch (signOutError) {
      }
    }
  };
  // Check for redirect result on mount
  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
          // Check if authentication is already in progress
          if (!isAuthenticatingRef.current) {
            await handleUserAuthentication(result.user);
          } else {
          }
        } else {
        }
      } catch (error) {
      }
    };
    checkRedirectResult();
  }, []);
  // Safety timeout - if loading takes too long, show error
  useEffect(() => {
    if (!isLoading) return;
    const timeout = setTimeout(() => {
      setError('Authentication is taking too long. Please refresh the page and try again.');
      setIsLoading(false);
      isSigningInRef.current = false;
    }, 45000); // 45 seconds timeout
    return () => clearTimeout(timeout);
  }, [isLoading]);
  const handleGoogleSignIn = async () => {
    if (isLoading || isSigningInRef.current) {
      return;
    }
    try {
      isSigningInRef.current = true;
      setIsLoading(true);
      setError('');
      // Add timeout to detect hanging
      const signInPromise = signInWithPopup(auth, googleProvider);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sign-in timeout after 30 seconds')), 30000)
      );
      const result = await Promise.race([signInPromise, timeoutPromise]);
      // Add a small delay to ensure state updates
      await new Promise(resolve => setTimeout(resolve, 100));
      await handleUserAuthentication(result.user);
    } catch (error) {
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
            By signing in, you agree to our <a href="https://draganddrop.in/legal/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium">Terms and Conditions</a> and <a href="https://draganddrop.in/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
};
export default Login;
