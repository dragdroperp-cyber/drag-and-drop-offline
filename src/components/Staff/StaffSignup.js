import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  UserCheck,
  CheckCircle,
  AlertCircle,
  Loader,
  Mail,
  Shield,
  Clock
} from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../../utils/firebase';
import { apiRequest } from '../../utils/api';

const StaffSignup = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [inviteData, setInviteData] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const token = searchParams.get('token');

  // Validate invite token on component mount
  useEffect(() => {
    if (!token) {
      setError('Invalid invite link. No token provided.');
      setLoading(false);
      return;
    }

    validateInviteToken();
  }, [token]);

  const validateInviteToken = async () => {
    setValidating(true);
    try {
      const response = await apiRequest(`/staff/invite/${token}`);

      if (response.success) {
        setInviteData(response.data.data);
      } else {
        setError(response.data?.message || response.message || 'Invalid or expired invite token');
      }
    } catch (error) {
      console.error('Error validating invite token:', error);
      setError('Failed to validate invite token. Please try again.');
    } finally {
      setValidating(false);
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!inviteData) return;

    setSigningUp(true);
    try {
      // Use the imported Firebase auth
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      if (!user) {
        setError('Failed to authenticate with Google. Please try again.');
        return;
      }

      // Extract user data
      const userData = {
        token: inviteData.token,
        email: user.email,
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL
      };

      console.log('Sending signup request with data:', userData);

      // Call staff signup API
      const response = await apiRequest('/staff/signup', {
        method: 'POST',
        body: userData
      });

      console.log('Signup response:', response);

      if (response.success) {
        setSuccess(true);
        // Redirect to staff dashboard or login page after a delay
        setTimeout(() => {
          navigate('/login'); // or wherever staff should go after signup
        }, 3000);
      } else {
        setError(response.data?.message || response.message || 'Failed to create staff account');
      }
    } catch (error) {
      console.error('Error during staff signup:', error);

      // Handle specific Firebase auth errors
      if (error.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled. Please try again.');
      } else if (error.code === 'auth/popup-blocked') {
        setError('Sign-in popup was blocked. Please allow popups and try again.');
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        setError('An account with this email already exists. Please sign in with the existing method.');
      } else {
        setError('Failed to create staff account. Please try again.');
      }
    } finally {
      setSigningUp(false);
    }
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Invalid Date';
    }
  };

  const getPermissionCount = (permissions) => {
    return Object.values(permissions || {}).filter(Boolean).length;
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Validating Invite</h2>
          <p className="text-gray-600">Please wait while we validate your invite token...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid Invite</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="w-full px-6 py-3 bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white rounded-xl font-bold hover:shadow-lg transition-all"
          >
            Go to Homepage
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome to the Team!</h2>
          <p className="text-gray-600 mb-6">
            Your staff account has been created successfully. You can now access the system with your assigned permissions.
          </p>
          <p className="text-sm text-gray-500">Redirecting you to login...</p>
        </div>
      </div>
    );
  }

  // Valid invite - show signup form
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-4">
            <UserCheck className="h-8 w-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Join the Team</h1>
          <p className="text-gray-600">Complete your staff account setup</p>
        </div>

        {/* Invite Details */}
        <div className="bg-gradient-to-r from-blue-50 to-slate-50 rounded-xl p-4 mb-6 border border-blue-200">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">Staff Invitation</h3>
              <p className="text-sm text-gray-600 mb-2">
                You've been invited to join <strong>{inviteData?.seller?.shopName || inviteData?.seller?.name || 'the team'}</strong>
              </p>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  {getPermissionCount(inviteData?.permissions)} permissions
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Expires {formatDate(inviteData?.expiryTime)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Permissions Preview */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-indigo-600" />
            Your Permissions
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(inviteData?.permissions || {})
              .filter(([, value]) => value)
              .map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3 text-green-600 flex-shrink-0" />
                  <span className="text-gray-700 capitalize">
                    {key.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* Sign Up Button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={signingUp}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white border-2 border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signingUp ? (
            <>
              <Loader className="h-5 w-5 animate-spin" />
              Creating Account...
            </>
          ) : (
            <>
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {/* Footer */}
        <p className="text-xs text-gray-500 text-center mt-6">
          By signing up, you agree to join the team and accept the assigned permissions.
          This invite expires and can only be used once.
        </p>
      </div>
    </div>
  );
};

export default StaffSignup;
