import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

const Toast = ({ id, message, type = 'info', onClose, duration = 3000 }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, duration);

    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  const icons = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colors = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  const Icon = icons[type] || Info;

  return (
    <div className={`flex items-start p-4 rounded-lg border shadow-lg min-w-[300px] max-w-[500px] ${colors[type]} animate-slideInRight mb-2`}>
      <Icon className="h-5 w-5 mr-3 flex-shrink-0 mt-0.5" />
      <div className="flex-1 pr-2">
        <p className="text-sm font-medium whitespace-pre-wrap break-words">{message}</p>
      </div>
      <button
        onClick={() => onClose(id)}
        className="flex-shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default Toast;

