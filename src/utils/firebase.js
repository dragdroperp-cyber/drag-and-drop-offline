// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

// TODO: Add SDKs for Firebase products that you want to use

// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration

// For Firebase JS SDK v7.20.0 and later, measurementId is optional

const firebaseConfig = {
  apiKey: "AIzaSyDCYsrrPg3VllgwR1K02jmvOo7bbgjtR3A",
  authDomain: "dragdrop-2a9a4.firebaseapp.com",
  projectId: "dragdrop-2a9a4",
  storageBucket: "dragdrop-2a9a4.firebasestorage.app",
  messagingSenderId: "1016804641337",
  appId: "1:1016804641337:web:306c4fa562b86f2cd61be8",
  measurementId: "G-GKV9HX0ZL8"
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

// Ensure auth is ready before use
if (typeof window !== 'undefined') {
  // Wait for auth to be ready
  auth.authStateReady().catch(() => {
    // Silently handle initialization errors
  });
}

// Initialize Analytics (only in browser)
let analytics;
if (typeof window !== 'undefined') {
  analytics = getAnalytics(app);
}

export { analytics };
export default app;

