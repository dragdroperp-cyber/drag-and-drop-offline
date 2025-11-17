import { useState, useEffect } from 'react';

/**
 * Custom hook to handle PWA install prompt
 * @returns {{ prompt: Event | null, isInstallable: boolean, isInstalled: boolean, install: () => Promise<void> }}
 */
export const usePWAInstall = () => {
  const [prompt, setPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Check if app is installed via other means
    if (window.navigator.standalone === true) {
      setIsInstalled(true);
      return;
    }

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e) => {
      // Prevent the default browser install prompt
      e.preventDefault();
      // Store the event for later use
      setPrompt(e);
      console.log('PWA install prompt available');
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setPrompt(null);
      console.log('PWA installed');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) {
      console.warn('Install prompt not available');
      return;
    }

    try {
      // Show the install prompt
      await prompt.prompt();
      
      // Wait for the user to respond
      const { outcome } = await prompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      
      // Clear the prompt
      setPrompt(null);
    } catch (error) {
      console.error('Error showing install prompt:', error);
    }
  };

  return {
    prompt,
    isInstallable: !!prompt && !isInstalled,
    isInstalled,
    install
  };
};

