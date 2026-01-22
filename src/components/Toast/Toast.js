import React, { useEffect, useState, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

const Toast = ({ id, message, type = 'info', onClose, duration = 3000 }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(id);
    }, 300); // Match transition duration
  };

  // Touch Handlers for Mobile Swipe
  const handleTouchStart = (e) => {
    setIsDragging(true);
    startXRef.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - startXRef.current;
    setTranslateX(diff);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    const threshold = 100; // Swipe threshold to dismiss
    if (Math.abs(translateX) > threshold) {
      // Swipe gesture confirmed - animate out in the direction of swipe
      setTranslateX(translateX > 0 ? 500 : -500);
      handleClose();
    } else {
      // Not enough swipe - snap back
      setTranslateX(0);
    }
  };

  const icons = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colors = {
    success: 'bg-green-50 border-green-200 text-green-800 dark:bg-black dark:border-green-500/20 dark:text-green-400',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-black dark:border-red-500/20 dark:text-red-400',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-black dark:border-yellow-500/20 dark:text-yellow-400',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-black dark:border-white/10 dark:text-blue-400',
  };

  const Icon = icons[type] || Info;

  return (
    <div
      className={`flex items-start p-4 rounded-lg border shadow-lg min-w-[300px] max-w-[500px] ${colors[type]} mb-2 transition-all duration-300 ease-out`}
      style={{
        transform: `translateX(${translateX}px)`,
        opacity: isExiting ? 0 : 1, // Fade out on exit
        marginBottom: isExiting ? -50 : 8, // Collapse space on exit
        transition: isDragging ? 'none' : 'all 0.3s ease-out'
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Icon className="h-5 w-5 mr-3 flex-shrink-0 mt-0.5" />
      <div className="flex-1 pr-2">
        <p className="text-sm font-medium whitespace-pre-wrap break-words">{message}</p>
      </div>
      <button
        onClick={() => handleClose()}
        className="flex-shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default Toast;
