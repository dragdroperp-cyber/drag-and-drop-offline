import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
/**
 * Custom hook for keyboard shortcuts
 * @param {string} key - The key to listen for (e.g., 'n', 'Enter')
 * @param {boolean} ctrlKey - Whether Ctrl key should be pressed
 * @param {boolean} shiftKey - Whether Shift key should be pressed
 * @param {Function} callback - Function to call when shortcut is triggered
 * @param {Array} dependencies - Dependencies for useEffect
 */
export const useKeyboardShortcut = (key, ctrlKey = false, shiftKey = false, callback, dependencies = []) => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Check if the pressed key matches and modifier key states match
      if (event.key && event.key.toLowerCase() === key.toLowerCase() &&
          event.ctrlKey === ctrlKey &&
          event.shiftKey === shiftKey) {
        // Don't trigger shortcuts when user is typing in form elements
        const activeElement = document.activeElement;
        const isFormElement = activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT' ||
          activeElement.contentEditable === 'true' ||
          activeElement.closest('[contenteditable="true"]')
        );
        // Skip shortcut if user is typing in a form element
        if (isFormElement) {
          return;
        }
        // Prevent default browser behavior
        event.preventDefault();
        event.stopPropagation();
        // Call the callback
        callback();
      }
    };
    // Add event listener
    document.addEventListener('keydown', handleKeyDown);
    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [key, ctrlKey, shiftKey, ...dependencies]);
};
/**
 * Hook for page-specific shortcuts
 * Automatically determines which page is active and calls appropriate callback
 */
export const usePageShortcut = (pageShortcuts) => {
  const location = useLocation();
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle Ctrl + N for now
      if (event.key.toLowerCase() === 'n' && event.ctrlKey) {
        // Don't trigger shortcuts when user is typing in form elements
        const activeElement = document.activeElement;
        const isFormElement = activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT' ||
          activeElement.contentEditable === 'true' ||
          activeElement.closest('[contenteditable="true"]')
        );
        // Skip shortcut if user is typing in a form element
        if (isFormElement) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        // Get current path
        const currentPath = location.pathname;
        // Find matching shortcut based on current path
        for (const shortcut of pageShortcuts) {
          if (shortcut.paths.some(path =>
            currentPath === path ||
            currentPath.startsWith(path + '/') ||
            path === '*' // Wildcard for any path
          )) {
            shortcut.callback();
            break;
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [location.pathname, pageShortcuts]);
};