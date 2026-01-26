import { useContext, useRef, useEffect, useState } from 'react';
import { AppContext } from '../context/AppContext';

/**
 * Custom hook to select specific slices of state from AppContext
 * This prevents unnecessary re-renders by only subscribing to specific state values
 * 
 * @param {Function} selector - Function that takes state and returns the slice you need
 * @param {Function} equalityFn - Optional custom equality function (defaults to shallow equality)
 * @returns {any} The selected state slice
 * 
 * @example
 * // Instead of using the entire state:
 * const { state } = useApp();
 * const customers = state.customers;
 * 
 * // Use selector to only subscribe to customers:
 * const customers = useAppSelector(state => state.customers);
 */
export const useAppSelector = (selector, equalityFn = shallowEqual) => {
    const { state } = useContext(AppContext);
    const selectedStateRef = useRef();
    const [, forceUpdate] = useState({});

    const selectedState = selector(state);

    useEffect(() => {
        if (!equalityFn(selectedState, selectedStateRef.current)) {
            selectedStateRef.current = selectedState;
            forceUpdate({});
        }
    }, [selectedState, equalityFn]);

    return selectedStateRef.current ?? selectedState;
};

/**
 * Shallow equality comparison
 */
function shallowEqual(objA, objB) {
    if (objA === objB) {
        return true;
    }

    if (typeof objA !== 'object' || objA === null ||
        typeof objB !== 'object' || objB === null) {
        return false;
    }

    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) {
        return false;
    }

    for (let i = 0; i < keysA.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) ||
            objA[keysA[i]] !== objB[keysA[i]]) {
            return false;
        }
    }

    return true;
}

/**
 * Hook to get only dispatch function (doesn't cause re-renders on state changes)
 */
export const useAppDispatch = () => {
    const { dispatch } = useContext(AppContext);
    return dispatch;
};
