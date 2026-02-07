import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, WifiOff } from 'lucide-react';

const RefreshProgressModal = ({ isOpen, progress, message, error, onClose }) => {
    const [displayedProgress, setDisplayedProgress] = useState(1);
    const requestRef = useRef();

    // Check if error is due to offline status or network failure
    const isOffline = error === 'offline' || (typeof error === 'string' && (
        error.toLowerCase().includes('offline') ||
        error.toLowerCase().includes('network') ||
        error.toLowerCase().includes('fetch') ||
        error.toLowerCase().includes('connection') ||
        error.toLowerCase().includes('timeout')
    ));

    // Reset displayed progress when modal opens or closes
    useEffect(() => {
        if (!isOpen) {
            setDisplayedProgress(1);
        } else if (progress === 0) {
            setDisplayedProgress(1);
        }
    }, [isOpen, progress]);

    // Smoothly animate progress
    useEffect(() => {
        if (!isOpen) return;

        const animate = () => {
            setDisplayedProgress(prev => {
                if (prev >= progress) return prev;
                // Determine increment speed based on distance
                // If far away, speed up slightly, but ensures we hit every number visually if possible within frames
                // The user specifically asked for "increase by 1 only"
                const next = prev + 1;
                return next > 100 ? 100 : next;
            });
            requestRef.current = requestAnimationFrame(animate);
        };

        if (displayedProgress < progress) {
            // slightly delay to make it visible
            // We can't use requestAnimationFrame directly for "increase by 1" effectively if we want to control speed.
            // Let's use a timeout/interval for the "tick"
        }
    }, [isOpen, progress, displayedProgress]);

    // Variable speed progress animation
    useEffect(() => {
        if (!isOpen) return;

        // Stop if we reached the target or 100%
        if (displayedProgress >= 100 || (displayedProgress >= progress && progress > 0)) {
            return;
        }

        // Determine speed
        let delay = 10;
        if (progress < 100) {
            // Slow mode with random "breaks"
            // Random between 40ms and 150ms to simulate work
            delay = Math.floor(Math.random() * 110) + 40;
        } else {
            // Fast mode - catch up to 100% quickly when done
            delay = 5;
        }

        const timer = setTimeout(() => {
            setDisplayedProgress(prev => {
                // If backend says 100, we allow going to 100.
                // If backend says X < 100, we cap at X.
                const target = progress;
                if (prev >= target) return prev;

                const next = prev + 1;
                return next > 100 ? 100 : next;
            });
        }, delay);

        return () => clearTimeout(timer);
    }, [isOpen, progress, displayedProgress]);

    // Auto-close when complete
    useEffect(() => {
        if (displayedProgress === 100 && !error) {
            const timer = setTimeout(() => {
                if (onClose) onClose();
            }, 150); // Instant auto-close (50ms to allow render)
            return () => clearTimeout(timer);
        }
    }, [displayedProgress, error, onClose]);

    if (!isOpen) return null;

    // Use displayedProgress for the visual feedback
    const activeProgress = error ? displayedProgress : displayedProgress;

    // Standard radius for the progress circle
    const radius = 38;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (activeProgress / 100) * circumference;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-sm rounded-[24px] bg-white dark:bg-[#121212] overflow-hidden shadow-2xl animate-in sub-bounce-in duration-300 relative border border-slate-200 dark:border-white/10">

                {/* Simplified Header */}
                <div className="px-6 py-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
                        {isOffline ? 'You are Offline' : error ? 'Update Failed' : activeProgress === 100 ? 'Sync Complete' : 'Syncing Data'}
                    </h3>
                    {/* Close button only when error */}
                    {error && (
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors p-1"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* Content Body */}
                <div className="p-8 flex flex-col items-center justify-center bg-slate-50/50 dark:bg-[#121212]">

                    {/* Progress Circle - Matching brand colors */}
                    <div className="relative h-40 w-40 flex items-center justify-center mb-6">
                        <svg className="absolute h-full w-full rotate-[-90deg]" viewBox="0 0 100 100">
                            {/* Track */}
                            <circle
                                className="text-slate-200 dark:text-neutral-800"
                                strokeWidth="6"
                                stroke="currentColor"
                                fill="transparent"
                                r={radius}
                                cx="50"
                                cy="50"
                            />

                            {/* Indicator */}
                            {!error && (
                                <circle
                                    className="transition-all duration-75 ease-linear text-[#0f172a] dark:text-white"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    strokeDasharray={circumference}
                                    strokeDashoffset={strokeDashoffset}
                                    stroke="currentColor"
                                    fill="transparent"
                                    r={radius}
                                    cx="50"
                                    cy="50"
                                />
                            )}
                        </svg>

                        {/* Center Content */}
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                            {isOffline ? (
                                <WifiOff className="h-12 w-12 text-amber-500" />
                            ) : error ? (
                                <AlertCircle className="h-12 w-12 text-rose-500" />
                            ) : (
                                <span className="text-4xl font-bold tracking-tighter tabular-nums text-slate-900 dark:text-white">
                                    {Math.round(activeProgress)}<span className="text-lg text-slate-400 font-normal">%</span>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Status Message */}
                    <p className="text-slate-600 dark:text-slate-400 text-center font-medium leading-relaxed px-2">
                        {isOffline
                            ? 'In offline mode, use this software only on 1 device until the data is synced 100%.'
                            : (message || (error ? 'Unable to sync data.' : activeProgress === 100 ? 'Completed' : 'Updating your inventory...'))
                        }
                    </p>

                    {/* Action Button - Only show on error */}
                    {error && (
                        <button
                            onClick={onClose}
                            className={`mt-6 w-full py-3 rounded-xl font-semibold text-white shadow-lg shadow-slate-200 dark:shadow-none transition-transform hover:scale-[1.02] active:scale-95 ${isOffline ? 'bg-amber-500 hover:bg-amber-600' : 'bg-rose-500 hover:bg-rose-600'}`}
                        >
                            {isOffline ? 'Understood' : 'Close'}
                        </button>
                    )}

                </div>
            </div>
        </div>
    );
};

export default RefreshProgressModal;
