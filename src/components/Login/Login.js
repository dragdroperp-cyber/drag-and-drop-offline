import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { signInWithPopup, getRedirectResult } from 'firebase/auth';
import { auth, googleProvider } from '../../utils/firebase';
import { getSellerId } from '../../utils/api';
import { Package, ShieldCheck, Smartphone, CheckCircle, ArrowRight, Zap, Globe, Sparkles } from 'lucide-react';

const Login = () => {
  const { dispatch, state } = useApp();
  const navigate = useNavigate();
  const logoSrc = `${process.env.PUBLIC_URL || ''}/assets/inventory-studio-logo-removebg.png`;
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isSigningInRef = useRef(false);
  const isAuthenticatingRef = useRef(false);

  // Feature list for the left panel
  const features = [
    {
      icon: <Zap className="h-5 w-5 text-amber-400" />,
      title: "Real-time Inventory",
      desc: "Track stock movements across all locations instantly."
    },
    {
      icon: <CheckCircle className="h-5 w-5 text-emerald-400" />,
      title: "Advanced Billing",
      desc: "Generate professional invoices and manage GST easily."
    },
    {
      icon: <Smartphone className="h-5 w-5 text-blue-400" />,
      title: "Offline Sync",
      desc: "Work without internet and sync data when back online."
    },
    {
      icon: <ShieldCheck className="h-5 w-5 text-indigo-400" />,
      title: "Secure & Reliable",
      desc: "Your business data is safely stored and backed up daily."
    }
  ];

  const handleUserAuthentication = async (user) => {
    if (isAuthenticatingRef.current) return;
    isAuthenticatingRef.current = true;

    if (!user || !user.email) {
      setError('Invalid user data received.');
      setIsLoading(false);
      return;
    }

    try {
      const idToken = await user.getIdToken();
      const sellerAuthResult = await getSellerId(user.email, user.uid, user.displayName, user.photoURL, idToken);

      if (sellerAuthResult && sellerAuthResult.success) {
        await proceedWithAuthentication(sellerAuthResult, 'seller', user);
      } else {
        setError('No account found for this email. Please register first.');
        setIsLoading(false);
      }
    } catch (error) {
      setError(`Authentication failed: ${error.message}`);
      setIsLoading(false);
    } finally {
      isAuthenticatingRef.current = false;
    }
  };

  const proceedWithAuthentication = async (authResult, userType, user) => {
    try {
      const userData = authResult[userType];
      let sellerId = userData.sellerId;
      if (userType === 'staff' && authResult.seller?._id) {
        sellerId = authResult.seller._id;
      }

      const payload = {
        ...userData,
        sellerId: sellerId,
        userType: userType,
        email: user?.email || userData.email || '',
        uid: user?.uid || ''
      };

      dispatch({ type: ActionTypes.LOGIN, payload: payload });
      setIsLoading(false);

      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 200);
    } catch (error) {
      setError(`Authentication failed: ${error.message}`);
      setIsLoading(false);
      try { await auth.signOut(); } catch (e) { }
    }
  };

  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result && result.user && !isAuthenticatingRef.current) {
          await handleUserAuthentication(result.user);
        }
      } catch (error) { }
    };
    checkRedirectResult();
  }, []);

  const handleGoogleSignIn = async () => {
    if (isLoading || isSigningInRef.current) return;
    try {
      isSigningInRef.current = true;
      setIsLoading(true);
      setError('');

      const signInPromise = signInWithPopup(auth, googleProvider);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sign-in timeout')), 30000)
      );

      const result = await Promise.race([signInPromise, timeoutPromise]);
      await new Promise(resolve => setTimeout(resolve, 100));
      await handleUserAuthentication(result.user);
    } catch (error) {
      if (error.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled.');
      } else {
        setError(`Sign-in failed: ${error.message}`);
      }
      setIsLoading(false);
    } finally {
      isSigningInRef.current = false;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes pulse-soft {
          0%, 100% { opacity: 0.1; transform: scale(1); }
          50% { opacity: 0.2; transform: scale(1.1); }
        }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .animate-pulse-soft { animation: pulse-soft 8s ease-in-out infinite; }
      `}</style>

      {/* Left Panel: Branding & Features (Desktop Only) */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden items-center justify-center p-12">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] -mr-64 -mt-64 animate-pulse-soft"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] -ml-64 -mb-64 animate-pulse-soft" style={{ animationDelay: '2s' }}></div>

        <div className="relative z-10 w-full max-w-lg">
          <h1 className="text-5xl font-black text-white mb-8 leading-[1.1] tracking-tight">
            Simplify your <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">Business Management</span>
          </h1>

          <div className="space-y-6">
            {features.map((feature, i) => (
              <div key={i} className="flex gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm transition-all hover:bg-white/10 hover:border-white/20 group translate-x-0 hover:translate-x-2">
                <div className="shrink-0 pt-1 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-bold text-white mb-0.5">{feature.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 flex items-center justify-center gap-4">
            <p className="text-slate-400 text-sm font-medium">
              Trusted by <span className="text-white font-bold">500+</span> business owners across India
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel: Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-12 bg-white lg:bg-slate-50">
        <div className="w-full max-w-[500px] animate-fadeIn">
          <div className="bg-white p-6 sm:p-10 rounded-[2.5rem] shadow-2xl shadow-blue-900/5 lg:border lg:border-slate-200/60 transition-all text-center">
            {/* Unified Branding Header */}
            <div className="flex flex-col items-center mb-10 text-center">
              <div className="h-28 w-28 flex items-center justify-center overflow-hidden mb-4">
                <img src={logoSrc} alt="Inventory Studio" className="h-full w-full object-contain" />
              </div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">Inventory Studio</h2>
              <p className="text-blue-600 text-xs font-black uppercase tracking-[0.3em] mt-2">Professional ERP</p>
            </div>

            <div className="text-center mb-10">
              <h1 className="text-2xl font-bold text-slate-800 mb-2 tracking-tight">Welcome Back</h1>
              <p className="text-slate-500 font-medium text-sm">Sign in to access your business dashboard</p>
            </div>

            {error && (
              <div className="mb-8 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                <div className="shrink-0 p-1 bg-red-100 text-red-600 rounded-lg">
                  <AlertTriangle size={16} />
                </div>
                <p className="text-red-700 text-sm font-bold leading-relaxed">{error}</p>
              </div>
            )}

            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="group relative w-full flex items-center justify-center gap-4 px-6 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden"
            >
              {/* Shine effect */}
              <div className="absolute top-0 -left-full w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent flex skew-x-[-20deg] group-hover:left-full transition-all duration-1000"></div>

              {isLoading ? (
                <>
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span className="font-bold tracking-tight">Authenticating...</span>
                </>
              ) : (
                <>
                  <div className="bg-white p-1 rounded-lg">
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="h-5 w-5" />
                  </div>
                  <span className="font-bold tracking-tight">Continue with Google</span>
                  <ArrowRight className="h-5 w-5 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all font-bold" />
                </>
              )}
            </button>

            <p className="mt-12 text-[10px] text-slate-400 leading-relaxed text-center font-medium">
              By continuing, you agree to our <br />
              <Link to="/terms-conditions" className="text-blue-600 hover:text-blue-700 font-bold underline transition-all">Terms</Link> & <Link to="/privacy-policy" className="text-blue-600 hover:text-blue-700 font-bold underline transition-all">Privacy Policy</Link>
            </p>
          </div>

          <div className="mt-12 text-center flex items-center justify-center gap-2 text-slate-400">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <p className="text-xs font-bold tracking-tight">Powered by Drag and Drop</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Add missing icon for error state
const AlertTriangle = ({ size = 24 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
);

export default Login;
