/**
 * Focus management utilities for accessibility
 */
/**
 * Make an element focusable by setting tabIndex
 * @param {HTMLElement} element - The element to make focusable
 * @param {number} tabIndex - The tab index value (default: 0)
 */
export const makeFocusable = (element, tabIndex = 0) => {
  if (element) {
    element.setAttribute('tabindex', tabIndex.toString());
  }
};
/**
 * Make an element non-focusable by setting tabIndex to -1
 * @param {HTMLElement} element - The element to make non-focusable
 */
export const makeNonFocusable = (element) => {
  if (element) {
    element.setAttribute('tabindex', '-1');
  }
};
/**
 * Set up proper tab order for the main application
 * This should be called when the app initializes
 */
export const setupTabOrder = () => {
  // Get the main app container
  const appContainer = document.querySelector('#root') || document.body;
  // Find all interactive elements that should be in tab order
  const interactiveElements = appContainer.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  // Ensure all interactive elements are properly focusable
  interactiveElements.forEach((element) => {
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '0');
    }
  });
  // Hide browser elements from tab order when app is focused
  const browserElements = document.querySelectorAll('a[href^="chrome://"], a[href^="about:"], [role="banner"] a, [role="navigation"] a[href^="http"]');
  browserElements.forEach((element) => {
    element.setAttribute('tabindex', '-1');
  });
};
/**
 * Restore browser element focusability when leaving the app
 */
export const restoreBrowserTabOrder = () => {
  const browserElements = document.querySelectorAll('a[href^="chrome://"], a[href^="about:"], [role="banner"] a, [role="navigation"] a[href^="http"]');
  browserElements.forEach((element) => {
    element.removeAttribute('tabindex');
  });
};
/**
 * Focus the first focusable element in a container
 * @param {HTMLElement} container - The container to search in
 */
export const focusFirstElement = (container) => {
  if (!container) return;
  const focusableElements = container.querySelectorAll(
    'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusableElements.length > 0) {
    focusableElements[0].focus();
  }
};
/**
 * Focus the last focusable element in a container
 * @param {HTMLElement} container - The container to search in
 */
export const focusLastElement = (container) => {
  if (!container) return;
  const focusableElements = container.querySelectorAll(
    'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusableElements.length > 0) {
    focusableElements[focusableElements.length - 1].focus();
  }
};