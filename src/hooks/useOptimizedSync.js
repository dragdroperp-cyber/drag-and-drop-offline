/**
 * useOptimizedSync Hook
 * 
 * Integrates the optimized sync manager with React components
 * Provides sync status, manual sync triggers, and automatic updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    initializeOptimizedSync,
    syncAllIncremental,
    autoSyncManager,
    clearCache,
    onSyncEvent
} from '../services/optimizedSyncManager';

export const useOptimizedSync = (options = {}) => {
    const {
        autoSync = true,
        syncInterval = 60000, // 1 minute
        onSyncComplete = null,
        onSyncError = null
    } = options;

    const [syncStatus, setSyncStatus] = useState({
        isSyncing: false,
        lastSyncTime: null,
        error: null,
        summary: null
    });

    const syncControllerRef = useRef(null);
    const unsubscribeRef = useRef(null);

    // Handle sync events
    useEffect(() => {
        const handleSyncEvent = (event, data) => {
            switch (event) {
                case 'sync_started':
                    setSyncStatus(prev => ({
                        ...prev,
                        isSyncing: true,
                        error: null
                    }));
                    break;

                case 'sync_completed':
                    setSyncStatus(prev => ({
                        ...prev,
                        isSyncing: false,
                        lastSyncTime: new Date(),
                        summary: data.summary,
                        error: null
                    }));
                    if (onSyncComplete) {
                        onSyncComplete(data);
                    }
                    break;

                case 'sync_error':
                    setSyncStatus(prev => ({
                        ...prev,
                        isSyncing: false,
                        error: data.error
                    }));
                    if (onSyncError) {
                        onSyncError(data.error);
                    }
                    break;

                case 'collection_synced':
                    // Individual collection synced - could update UI incrementally
                    console.log(`[SYNC] Collection synced: ${data.collection}`);
                    break;

                default:
                    break;
            }
        };

        // Subscribe to sync events
        unsubscribeRef.current = onSyncEvent(handleSyncEvent);

        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
            }
        };
    }, [onSyncComplete, onSyncError]);

    // Initialize sync on mount
    useEffect(() => {
        console.log('[useOptimizedSync] Initializing optimized sync system...');

        syncControllerRef.current = initializeOptimizedSync({
            autoSync,
            syncInterval,
            initialSync: true
        });

        return () => {
            // Cleanup on unmount
            if (syncControllerRef.current?.stopAutoSync) {
                syncControllerRef.current.stopAutoSync();
            }
        };
    }, [autoSync, syncInterval]);

    // Manual sync trigger
    const syncNow = useCallback(async () => {
        if (syncStatus.isSyncing) {
            console.log('[useOptimizedSync] Sync already in progress');
            return { success: false, error: 'Sync in progress' };
        }

        try {
            const result = await syncAllIncremental();
            return result;
        } catch (error) {
            console.error('[useOptimizedSync] Error during manual sync:', error);
            return { success: false, error: error.message };
        }
    }, [syncStatus.isSyncing]);

    // Clear cache
    const clearSyncCache = useCallback(() => {
        clearCache();
        console.log('[useOptimizedSync] Cache cleared');
    }, []);

    // Start/stop auto-sync
    const startAutoSync = useCallback(() => {
        if (syncControllerRef.current?.startAutoSync) {
            syncControllerRef.current.startAutoSync();
        }
    }, []);

    const stopAutoSync = useCallback(() => {
        if (syncControllerRef.current?.stopAutoSync) {
            syncControllerRef.current.stopAutoSync();
        }
    }, []);

    return {
        // Status
        isSyncing: syncStatus.isSyncing,
        lastSyncTime: syncStatus.lastSyncTime,
        syncError: syncStatus.error,
        syncSummary: syncStatus.summary,

        // Actions
        syncNow,
        clearCache: clearSyncCache,
        startAutoSync,
        stopAutoSync
    };
};

export default useOptimizedSync;
