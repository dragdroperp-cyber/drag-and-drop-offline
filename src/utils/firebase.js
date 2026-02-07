// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

// TODO: Add SDKs for Firebase products that you want to use

// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration

// For Firebase JS SDK v7.20.0 and later, measurementId is optional

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
// Add additional scopes if needed
googleProvider.addScope('profile');
googleProvider.addScope('email');
// Set custom parameters to ensure proper popup behavior
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Handle offline/online state changes for Firebase
if (typeof window !== 'undefined') {
  // Listen for online/offline events to handle Firebase gracefully
  window.addEventListener('online', () => {

  });

  window.addEventListener('offline', () => {

  });

  // Ensure auth is ready before use
  auth.authStateReady().catch((error) => {

    // Silently handle initialization errors - auth may work offline
  });
}

// Initialize Analytics (only in browser and when online)
let analytics;
if (typeof window !== 'undefined') {
  try {
    // Only initialize analytics if we're online to avoid Firebase offline errors
    if (navigator.onLine) {
      analytics = getAnalytics(app);
    } else {

    }
  } catch (error) {

    // Silently fail - analytics is not critical for app functionality
  }
}

export { analytics };
export default app;
