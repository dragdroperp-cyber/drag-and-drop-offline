import React, { useState, useEffect } from 'react';
import { useApp, triggerSyncStatusUpdate } from '../../context/AppContext';
import { STORES, updateItem } from '../../utils/indexedDB';
import {
    Receipt,
    Palette,
    ChevronRight,
    BarChart3,
    Mail as MailIcon,
    Monitor,
    Sparkles
} from 'lucide-react';
import BillEditor from './Editors/BillEditor';
import ReportEditor from './Editors/ReportEditor';
import EmailEditor from './Editors/EmailEditor';

const Customization = () => {
    const { state, syncPendingData } = useApp();
    const [activeEditor, setActiveEditor] = useState(null);
    const [loading, setLoading] = useState(true);

    // Filter current plan's settings from state
    const sellerSettings = state.currentPlanDetails?.sellerSettings || {};

    useEffect(() => {
        const timer = setTimeout(() => setLoading(false), 300);
        return () => clearTimeout(timer);
    }, []);

    const handleSaveSettings = async (updatedSettings) => {
        try {
            const sellerId = state.currentUser?.sellerId || state.currentUser?.id;
            if (!sellerId) throw new Error("No user session found");

            // Merge with existing settings
            const currentSettings = state.currentPlanDetails?.sellerSettings || {};
            const finalSettings = {
                ...currentSettings,
                ...updatedSettings
            };

            // 1. Save to IDB immediately (isSynced: false)
            await updateItem(STORES.settings, {
                id: `settings_${sellerId}`,
                sellerId,
                ...finalSettings,
                isSynced: false,
                updatedAt: new Date().toISOString()
            });

            // 2. Trigger sync status update to show "Syncing..." in UI
            triggerSyncStatusUpdate();

            // 3. Trigger background sync
            if (state.systemStatus === 'online') {
                syncPendingData().then(result => {
                    if (result && result.success) {
                        triggerSyncStatusUpdate();
                    }
                }).catch(err => console.error("Sync failed:", err));
            }

            if (window.showToast) window.showToast('Settings saved successfully', 'success');
            return { success: true };
        } catch (error) {
            console.error('Failed to save settings:', error);
            if (window.showToast) window.showToast('Failed to save settings', 'error');
            return { success: false, error };
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (activeEditor === 'bill') {
        return <BillEditor
            onBack={() => setActiveEditor(null)}
            initialSettings={sellerSettings.billSettings}
            onSave={(data) => handleSaveSettings({ billSettings: data })}
        />;
    }

    if (activeEditor === 'report') {
        return <ReportEditor
            onBack={() => setActiveEditor(null)}
            initialSettings={sellerSettings.reportSettings}
            onSave={(data) => handleSaveSettings({ reportSettings: data })}
        />;
    }

    if (activeEditor === 'email') {
        return <EmailEditor
            onBack={() => setActiveEditor(null)}
            initialSettings={sellerSettings.emailSettings}
            onSave={(data) => handleSaveSettings({ emailSettings: data })}
        />;
    }

    return (
        <div className="min-h-full bg-slate-50/50 dark:bg-black p-4 md:p-6 lg:p-10 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="max-w-6xl mx-auto mb-6 md:mb-10">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-indigo-600 rounded-lg shadow-indigo-200 shadow-lg dark:shadow-none">
                        <Palette className="w-4 h-4 md:w-5 md:h-5 text-white" />
                    </div>
                    <span className="text-xs md:text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest px-1">Studio Core</span>
                </div>
                <h1 className="text-2xl md:text-4xl font-black text-slate-800 dark:text-white tracking-tight">
                    Customization <span className="text-indigo-600">Workspace</span>
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-2xl text-base md:text-lg">
                    Personalize your invoices, reports, and communication templates to match your brand identity.
                </p>
            </div>

            {/* Selection Grid */}
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {/* Bill Customization */}
                <div
                    onClick={() => setActiveEditor('bill')}
                    className="group relative bg-white dark:bg-black rounded-2xl md:rounded-3xl p-6 md:p-8 border border-slate-200 dark:border-white/10 shadow-sm hover:shadow-2xl hover:shadow-indigo-500/10 transition-all duration-300 cursor-pointer overflow-hidden border-b-4 border-b-transparent hover:border-b-indigo-500"
                >
                    <div className="absolute top-0 right-0 p-4 md:p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Receipt className="w-24 h-24 md:w-32 md:h-32 text-indigo-600" />
                    </div>

                    <div className="relative z-10">
                        <div className="w-12 h-12 md:w-14 md:h-14 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl md:rounded-2xl flex items-center justify-center mb-4 md:mb-6 border border-indigo-100 dark:border-indigo-800 group-hover:scale-110 transition-transform">
                            <Receipt className="w-6 h-6 md:w-7 md:h-7 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <h3 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-white mb-2 md:mb-3">Bill Designer</h3>
                        <p className="text-slate-500 dark:text-slate-400 text-xs md:text-sm leading-relaxed mb-4 md:mb-6">
                            Configure thermal and A4 bill formats, add logos, customize headers, and manage VAT/GST display.
                        </p>
                        <div className="flex items-center text-indigo-600 dark:text-indigo-400 font-bold text-xs md:text-sm tracking-wide group-hover:gap-2 transition-all">
                            OPEN EDITOR <ChevronRight className="w-4 h-4" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Info Section */}
            <div className="max-w-6xl mx-auto mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-800 dark:bg-white/5 rounded-2xl p-6 flex items-start gap-4 shadow-lg shadow-indigo-500/5 border dark:border-white/10">
                    <div className="p-2 bg-slate-700 rounded-lg">
                        <Monitor className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h4 className="text-white font-bold mb-1">Live Preview</h4>
                        <p className="text-slate-400 text-sm">All changes can be previewed in real-time before saving to ensure everything looks perfect.</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-black rounded-2xl p-6 border border-slate-200 dark:border-white/10 flex items-start gap-4 shadow-sm">
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
                        <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h4 className="text-slate-800 dark:text-white font-bold mb-1">Global Styles</h4>
                        <p className="text-slate-500 dark:text-slate-400 text-sm">Your customizations are synced to your account and applied across all your devices.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Customization;
