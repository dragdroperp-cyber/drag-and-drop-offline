import { useState, useCallback } from 'react';

export const useToast = () => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now();
    setToasts(prev => {
      const withoutDuplicate = prev.filter(
        toast => !(toast.message === message && toast.type === type)
      );
      return [...withoutDuplicate, { id, message, type, duration }];
    });
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  return { toasts, showToast, removeToast, clearAll };
};

