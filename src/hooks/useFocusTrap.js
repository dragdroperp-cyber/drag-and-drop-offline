import { useEffect, useRef } from 'react';
/**
 * Hook for trapping focus within a modal or dialog
 * @param {boolean} isActive - Whether the focus trap should be active
 * @returns {Object} - Object with focus trap utilities
 */
export const useFocusTrap = (isActive = true) => {
  const containerRef = useRef(null);
  const previouslyFocusedElementRef = useRef(null);
  useEffect(() => {
    if (!isActive) return;
    // Store the currently focused element
    previouslyFocusedElementRef.current = document.activeElement;
    // Get all focusable elements within the container
    const getFocusableElements = () => {
      if (!containerRef.current) return [];
      const focusableSelectors = [
        'a[href]',
        'area[href]',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'button:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        '[contenteditable="true"]'
      ];
      return Array.from(
        containerRef.current.querySelectorAll(focusableSelectors.join(', '))
      ).filter(element => {
        // Check if element is visible
        const style = window.getComputedStyle(element);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               !element.hasAttribute('inert');
      });
    };
    // Focus the first focusable element
    const focusFirstElement = () => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    };
    // Focus the last focusable element
    const focusLastElement = () => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[focusableElements.length - 1].focus();
      }
    };
    // Handle keyboard navigation
    const handleKeyDown = (event) => {
      if (!containerRef.current) return;
      if (event.key === 'Tab') {
        const focusableElements = getFocusableElements();
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
      // Close modal on Escape
      if (event.key === 'Escape') {
        event.preventDefault();
        // Find and click the close button if it exists
        const closeButton = containerRef.current.querySelector('[data-modal-close]');
        if (closeButton) {
          closeButton.click();
        }
      }
    };
    // Handle focus events to prevent focus from leaving the modal
    const handleFocusOut = (event) => {
      if (!containerRef.current) return;
      // Small delay to allow focus to move to new element
      setTimeout(() => {
        if (containerRef.current && document.activeElement && !containerRef.current.contains(document.activeElement)) {
          // Focus has left the modal, bring it back
          const focusableElements = getFocusableElements();
          if (focusableElements.length > 0) {
            focusableElements[0].focus();
          }
        }
      }, 10);
    };
    // Set up focus trap
    const setupFocusTrap = () => {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('focusout', handleFocusOut);
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        focusFirstElement();
      }, 10);
    };
    // Clean up focus trap
    const cleanupFocusTrap = () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusout', handleFocusOut);
      // Return focus to previously focused element
      if (previouslyFocusedElementRef.current &&
          typeof document.contains === 'function' &&
          document.contains(previouslyFocusedElementRef.current)) {
        previouslyFocusedElementRef.current.focus();
      }
    };
    setupFocusTrap();
    return cleanupFocusTrap;
  }, [isActive]);
  return {
    containerRef,
    // Utility to manually focus first element
    focusFirst: () => {
      if (!containerRef.current) return;
      const focusableElements = containerRef.current.querySelectorAll(
        'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }
  };
};