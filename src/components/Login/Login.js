import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../../utils/firebase';
import { getSellerId } from '../../utils/api';
import { Shield, Sparkles, TrendingUp, ArrowRight } from 'lucide-react';

const Login = () => {
  const { dispatch } = useApp();
  const logoSrc = `${process.env.PUBLIC_URL || ''}/assets/drag-and-drop-logo.jpg`;
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isSigningInRef = useRef(false);
  const [showTerms, setShowTerms] = useState(false);

  // Check for redirect result on mount
  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
          const user = result.user;
          
          // Create/verify seller in backend - creates new seller if doesn't exist
          try {
            const result = await getSellerId(
              user.email,
              user.uid,
              user.displayName,
              user.photoURL
            );

            if (result.success && result.sellerId) {
              console.log('✅ Seller received from backend:', result.seller);
              
              const loginPayload = {
                // Firebase user data
                username: user.displayName || user.email || 'User',
                photoURL: user.photoURL,
                uid: user.uid,
                
                // ALL seller data from backend
                ...result.seller,
                
                // Ensure sellerId is set
                sellerId: result.sellerId
              };
              
              console.log('📤 Dispatching LOGIN with payload:', loginPayload);
              console.log('  - name:', loginPayload.name);
              console.log('  - shopName:', loginPayload.shopName);
              console.log('  - phoneNumber:', loginPayload.phoneNumber);
              console.log('  - city:', loginPayload.city);
              
              dispatch({ 
                type: 'LOGIN', 
                payload: loginPayload
              });
            } else if (result.status === 403) {
              // Account inactive - deny access
              console.warn('Access denied: Seller account is inactive');
              auth.signOut().catch(console.error);
            } else {
              // Other errors - deny access for security
              console.error('Backend verification failed:', result.error);
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
        setTimeout(() => reject(new Error('Sign-in timeout')), 30000)
      );
      
      const result = await Promise.race([signInPromise, timeoutPromise]);
      const user = result.user;
      
      // Create/verify seller in backend database - creates new seller if doesn't exist
      try {
        const result = await getSellerId(
          user.email,
          user.uid,
          user.displayName,
          user.photoURL
        );

        if (result.success && result.sellerId) {
          console.log('✅ Seller received from backend:', result.seller);
          
          const loginPayload = {
            // Firebase user data
            username: user.displayName || user.email || 'User',
            photoURL: user.photoURL,
            uid: user.uid,
            
            // ALL seller data from backend
            ...result.seller,
            
            // Ensure sellerId is set
            sellerId: result.sellerId
          };
          
          console.log('📤 Dispatching LOGIN with payload:', loginPayload);
          console.log('  - name:', loginPayload.name);
          console.log('  - shopName:', loginPayload.shopName);
          console.log('  - phoneNumber:', loginPayload.phoneNumber);
          
          dispatch({ 
            type: 'LOGIN', 
            payload: loginPayload
          });
        } else {
          // Handle different error status codes
          if (result.status === 403) {
            // Account inactive
            setError(result.error || 'Your account has been deactivated. Please contact administrator.');
            auth.signOut().catch(console.error);
            return;
          } else {
            // Other backend errors
            setError(result.error || 'Unable to verify your account. Please try again or contact support.');
            auth.signOut().catch(console.error);
            return;
          }
        }
      } catch (authError) {
        // If backend is not available, deny access for security
        console.error('Backend auth error:', authError);
        setError('Unable to connect to server. Please check your connection and try again.');
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
          
          try {
            const result = await getSellerId(
              user.email,
              user.uid,
              user.displayName,
              user.photoURL
            );

            if (result.success && result.sellerId) {
              // Seller created/verified - allow access
              console.log('✅ Seller received from backend:', result.seller);
              
              const loginPayload = {
                // Firebase user data
                username: user.displayName || user.email || 'User',
                photoURL: user.photoURL,
                uid: user.uid,
                
                // ALL seller data from backend (includes all settings fields)
                ...result.seller,
                
                // Ensure sellerId is set
                sellerId: result.sellerId
              };
              
              console.log('📤 Dispatching LOGIN with payload:', loginPayload);
              console.log('  - name:', loginPayload.name);
              console.log('  - shopName:', loginPayload.shopName);
              console.log('  - phoneNumber:', loginPayload.phoneNumber);
              
              dispatch({ 
                type: 'LOGIN', 
                payload: loginPayload
              });
            } else if (result.status === 403) {
              // Account inactive - deny access
              console.warn('Access denied: Seller account is inactive');
              auth.signOut().catch(console.error);
            } else {
              // Other backend errors - deny access for security
              console.error('Backend verification failed:', result.error);
              auth.signOut().catch(console.error);
            }
          } catch (authError) {
            // Backend unavailable - deny access for security
            console.error('Backend auth error:', authError);
            auth.signOut().catch(console.error);
          }
        };
        
        // Check current user first
        if (auth.currentUser) {
          await handleUserLogin(auth.currentUser);
        }
        
        // Set up listener for auth state changes
        unsubscribe = auth.onAuthStateChanged(async (user) => {
          if (!isMounted) return;
          
          if (user) {
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#f5f9ff] via-white to-[#e6f0ff] text-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-24 h-[55vh] w-[55vh] rounded-full bg-sky-200/40 blur-3xl login-glow"></div>
        <div className="absolute bottom-0 right-0 h-[60vh] w-[60vh] rounded-full bg-white/70 blur-3xl login-glow" style={{ animationDelay: '2s' }}></div>
        <div className="absolute inset-x-0 top-12 mx-auto h-64 max-w-5xl bg-gradient-to-r from-sky-100/80 via-white/60 to-sky-50/80 blur-2xl login-glow" style={{ animationDelay: '4s' }}></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.18),transparent_65%)] login-glow" style={{ animationDuration: '24s' }}></div>
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0)_0%,rgba(231,238,250,0.55)_45%,rgba(255,255,255,0)_80%)] opacity-70"></div>
        <div className="absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-transparent via-sky-100/60 to-transparent login-glow" style={{ animationDuration: '28s' }}></div>
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col-reverse gap-10 px-6 pb-12 pt-8 sm:px-10 lg:flex-row lg:items-start lg:gap-16 lg:px-8 lg:pb-14 lg:pt-12">
        <section className="flex flex-1 flex-col gap-10">
          <div className="mx-auto w-full max-w-xl space-y-9 login-fade-up">
            <div className="flex items-center gap-3 text-slate-700 login-fade-up login-delay-1">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-sky-100 bg-white shadow-lg text-sky-600">
                <Shield className="h-8 w-8" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Drag &amp; Drop</p>
                <p className="text-lg font-semibold text-slate-800">Enterprise retail suite</p>
              </div>
            </div>

            <div className="space-y-7 login-fade-up login-delay-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-white px-5 py-2 text-sm font-semibold text-sky-600 shadow-sm login-float">
                <Sparkles className="h-4 w-4 text-sky-500" />
                Launch-ready in minutes
              </div>

              <div className="space-y-4">
                <h1 className="text-4xl font-semibold leading-tight text-slate-900 sm:text-[2.8rem] sm:leading-[1.15]">
                  Billing, inventory, and intelligence in one clear control room.
                </h1>
                <p className="text-base text-slate-600">
                  Google-secured sign in. Live KPIs. Offline resilience that keeps selling when Wi‑Fi doesn’t.
                </p>
              </div>

              <div className="h-px w-24 bg-gradient-to-r from-sky-200 via-sky-400/70 to-transparent login-fade-up login-delay-3"></div>

              <div className="grid gap-4 sm:grid-cols-3 login-fade-up login-delay-4">
                {[
                  {
                    icon: Shield,
                    title: 'Secure SSO',
                    body: 'Google Workspace enforced.',
                  },
                  {
                    icon: TrendingUp,
                    title: 'Live KPIs',
                    body: 'Sales & stock at a glance.',
                  },
                  {
                    icon: ArrowRight,
                    title: 'Offline sync',
                    body: 'Automatic catch-up.',
                  },
                ].map(({ icon: Icon, title, body }, index) => (
                  <div
                    key={title}
                    className="group rounded-2xl border border-sky-100 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:border-sky-200 hover:shadow-lg login-fade-up"
                    style={{ animationDelay: `${0.5 + index * 0.1}s` }}
                  >
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600 group-hover:bg-sky-200">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="text-xs text-slate-500">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-3xl border border-white/70 bg-white/85 p-6 text-slate-600 shadow-[0_25px_60px_-45px_rgba(14,165,233,0.45)] backdrop-blur login-fade-up login-delay-5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="tracking-[0.25em] uppercase">Trust signals</span>
                <span className="uppercase tracking-[0.2em]">Verified data</span>
              </div>
              <div className="flex flex-col gap-3 text-sm sm:flex-row sm:gap-0 sm:divide-x sm:divide-sky-100">
                <div className="flex-1 rounded-2xl border border-sky-100 bg-white px-4 py-3 shadow-sm sm:rounded-2xl sm:border-0 sm:bg-transparent sm:px-6 login-fade-up" style={{ animationDelay: '0.6s' }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-slate-400">Trusted sellers</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">200+</p>
                  <p className="text-[11px] text-sky-600">Onboarded with confidence</p>
                </div>
                <div className="flex-1 rounded-2xl border border-sky-100 bg-white px-4 py-3 shadow-sm sm:border-0 sm:bg-transparent sm:px-6 login-fade-up" style={{ animationDelay: '0.75s' }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-slate-400">Markets served</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">5+ cities</p>
                  <p className="text-[11px] text-sky-600">Expanding every quarter</p>
                </div>
                <div className="flex-1 rounded-2xl border border-sky-100 bg-white px-4 py-3 shadow-sm sm:rounded-2xl sm:border-0 sm:bg-transparent sm:px-6 login-fade-up" style={{ animationDelay: '0.9s' }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-slate-400">Sync reliability</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">99.8%</p>
                  <p className="text-[11px] text-slate-500">Backed by auto recovery</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 hidden text-sm text-slate-400 lg:block">
            © {new Date().getFullYear()} Drag &amp; Drop Labs. Crafted for modern retail leaders.
          </div>
        </section>

        <section className="flex flex-1 items-start justify-center">
          <div className="w-full max-w-md rounded-3xl border border-sky-100 bg-white/95 p-10 shadow-[0_35px_90px_-45px_rgba(15,23,42,0.4)] backdrop-blur login-fade-up login-delay-6">
            <div className="space-y-3 text-center login-fade-up login-delay-7">
              <div className="mx-auto flex h-20 w-22 items-center justify-center rounded-2xl  bg-transparent overflow-hidden " >
                <img
                  src={logoSrc}
                  alt="Drag & Drop"
                  className="h-40 w-40 object-cover "
                  onError={(e) => { e.currentTarget.src = `${process.env.PUBLIC_URL || ''}/assets/drag-drop-logo.png`; }}
                />
              </div>
              <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">Sign in securely</h2>
              <p className="text-sm text-slate-500">One tap unlocks your entire workspace.</p>
            </div>

            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="mt-8 w-full rounded-xl border border-slate-200 bg-white py-3.5 px-4 text-sm font-semibold text-slate-900 shadow-[0_18px_45px_-28px_rgba(14,165,233,0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_25px_55px_-25px_rgba(14,165,233,0.45)] disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none login-fade-up login-delay-8"
            >
              <span className="flex items-center justify-center gap-3">
                {isLoading ? (
                  <>
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900/20 border-t-slate-900"></div>
                    <span>Authenticating…</span>
                  </>
                ) : (
                  <>
                    <img
                      src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                      alt="Google logo"
                      className="h-5 w-5"
                    />
                    <span>Continue with Google</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </span>
            </button>

            <div className="mt-6 space-y-3 text-xs text-slate-500 login-fade-up login-delay-9">
              <div className="flex items-center justify-center gap-2">
                <div className="h-px w-6 bg-slate-200" />
                <span>Enterprise safeguards</span>
                <div className="h-px w-6 bg-slate-200" />
              </div>
              <div className="grid gap-2 text-left">
                <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2">
                  <Shield className="h-4 w-4 text-sky-600" />
                  <span className="text-[13px] text-slate-600">SSO managed by Google</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2">
                  <TrendingUp className="h-4 w-4 text-sky-600" />
                  <span className="text-[13px] text-slate-600">Data syncs the moment you reconnect</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-6 rounded-xl border border-rose-400/40 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {error}
              </div>
            )}

            <div className="mt-6 text-[13px] text-slate-400">
              Your credentials stay with Google. We never see or store your password.
            </div>
            <button
              type="button"
              onClick={() => setShowTerms(true)}
              className="mt-4 text-sm font-medium text-sky-600 transition hover:text-sky-500"
            >
              View Terms &amp; Conditions
            </button>
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
