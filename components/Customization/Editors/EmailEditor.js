import React, { useState } from 'react';
import { ArrowLeft, Save, Mail, Bell, AlertTriangle, Loader } from 'lucide-react';

const EmailEditor = ({ onBack, initialSettings, onSave }) => {
    const [saving, setSaving] = useState(false);
    const [mobileView, setMobileView] = useState('config'); // 'config' or 'preview'
    const [config, setConfig] = useState({
        enabled: initialSettings?.enableLowStockAlerts ?? true,
        threshold: initialSettings?.alertThreshold || 10,
        frequency: initialSettings?.frequency || 'daily', // immediate, daily, weekly
        template: 'default', // Local UI state only
        enableDailySummary: initialSettings?.enableDailySummary ?? false
    });

    const handleSave = async () => {
        setSaving(true);
        const settingsToSave = {
            enableLowStockAlerts: config.enabled,
            alertThreshold: config.threshold,
            frequency: config.frequency,
            enableDailySummary: config.enableDailySummary
            // template is not saved to backend in this version
        };

        await onSave(settingsToSave);
        setSaving(false);
        if (window.showToast) window.showToast('Alert preferences saved!', 'success');
    }

    return (
        <div className="flex h-full flex-col bg-gray-100 dark:bg-black overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between bg-white dark:bg-black px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 dark:border-white/10 shadow-sm gap-4">
                <div className="flex items-center w-full md:w-auto">
                    <button onClick={onBack} className="mr-3 p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-slate-400" />
                    </button>
                    <h1 className="text-lg md:text-xl font-bold text-gray-800 dark:text-white">Alert Customization</h1>

                    {/* Mobile Toggle */}
                    <div className="flex md:hidden ml-auto bg-gray-100 dark:bg-white/5 rounded-lg p-1">
                        <button
                            onClick={() => setMobileView('config')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mobileView === 'config' ? 'bg-white dark:bg-white/10 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-slate-500'}`}
                        >
                            SETTINGS
                        </button>
                        <button
                            onClick={() => setMobileView('preview')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mobileView === 'preview' ? 'bg-white dark:bg-white/10 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-slate-500'}`}
                        >
                            PREVIEW
                        </button>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full md:w-auto px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold text-xs md:text-sm shadow-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    {saving ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {saving ? 'Saving...' : 'Save Preferences'}
                </button>
            </div>

            <div className="flex flex-1 overflow-hidden relative">
                {/* Sidebar */}
                <div className={`${mobileView === 'config' ? 'block' : 'hidden'} md:block w-full md:w-80 bg-white dark:bg-black border-r border-gray-200 dark:border-white/10 p-4 md:p-6 overflow-y-auto`}>
                    <div className="space-y-8">
                        <section>
                            <h3 className="text-xs md:text-sm font-bold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Low Stock Alerts</h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                                    <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Enable Alerts</span>
                                    <div className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${config.enabled ? 'bg-indigo-600' : 'bg-gray-300'}`} onClick={() => setConfig({ ...config, enabled: !config.enabled })}>
                                        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-300 ease-in-out ${config.enabled ? 'translate-x-5' : ''}`}></div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1 uppercase">Threshold (Units)</label>
                                    <input
                                        type="number"
                                        value={config.threshold}
                                        onChange={e => setConfig({ ...config, threshold: parseInt(e.target.value) })}
                                        className="w-full rounded-md border-gray-300 dark:border-white/10 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm py-2 bg-white dark:bg-white/5 dark:text-white px-3"
                                    />
                                    <p className="text-[10px] md:text-xs text-gray-500 mt-1">Alert when stock falls below this value.</p>
                                </div>
                            </div>
                        </section>

                        <section>
                            <h3 className="text-xs md:text-sm font-bold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Daily Summary</h3>
                            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl mb-4">
                                <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Receive Daily Recap</span>
                                <div className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${config.enableDailySummary ? 'bg-indigo-600' : 'bg-gray-300'}`} onClick={() => setConfig({ ...config, enableDailySummary: !config.enableDailySummary })}>
                                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-300 ease-in-out ${config.enableDailySummary ? 'translate-x-5' : ''}`}></div>
                                </div>
                            </div>

                            <h3 className="text-xs md:text-sm font-bold text-gray-900 dark:text-white mb-4 mt-6 uppercase tracking-wider">Alert Frequency</h3>
                            <div className="space-y-2">
                                {['immediate', 'daily', 'weekly'].map(f => (
                                    <label key={f} className="flex items-center p-3 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl transition-colors space-x-3 cursor-pointer border border-gray-100 dark:border-white/10">
                                        <input
                                            type="radio"
                                            name="frequency"
                                            checked={config.frequency === f}
                                            onChange={() => setConfig({ ...config, frequency: f })}
                                            className="h-4 w-4 text-indigo-600 dark:text-indigo-400 border-gray-300 dark:border-white/20 focus:ring-indigo-500 bg-white dark:bg-white/10"
                                        />
                                        <span className="text-sm font-medium text-gray-700 dark:text-slate-300 capitalize">{f} Summary</span>
                                    </label>
                                ))}
                            </div>
                        </section>
                    </div>
                </div>

                {/* Preview */}
                <div className={`${mobileView === 'preview' ? 'flex' : 'hidden'} md:flex flex-1 bg-gray-100 dark:bg-zinc-950 p-4 md:p-10 overflow-auto justify-center`}>
                    <div className="w-full max-w-2xl origin-top transform scale-90 sm:scale-100">
                        <div className="bg-white shadow-xl rounded-lg overflow-hidden border border-gray-200">
                            {/* Fake Email Window Frame */}
                            <div className="bg-gray-800 px-4 py-3 flex items-center space-x-2">
                                <div className="w-2 md:w-3 h-2 md:h-3 rounded-full bg-red-500"></div>
                                <div className="w-2 md:w-3 h-2 md:h-3 rounded-full bg-yellow-500"></div>
                                <div className="w-2 md:w-3 h-2 md:h-3 rounded-full bg-green-500"></div>
                                <div className="ml-4 flex-1 bg-gray-700 rounded h-4 md:h-6 w-1/2"></div>
                            </div>

                            {/* Email Body */}
                            <div className="p-4 md:p-8">
                                <div className="border-b border-gray-200 pb-4 md:pb-6 mb-4 md:mb-6">
                                    <h2 className="text-lg md:text-xl font-bold text-gray-800 leading-tight">Low Stock Alert: Action Required</h2>
                                    <p className="text-[10px] md:text-sm text-gray-500 mt-1">From: Grocery Studio Logic &lt;alerts@grocerystudio.com&gt;</p>
                                    <p className="text-[10px] md:text-sm text-gray-500">To: You &lt;manager@store.com&gt;</p>
                                </div>

                                <div className="prose max-w-none text-xs md:text-sm">
                                    <p className="text-gray-600 mb-4">Hello,</p>
                                    <p className="text-gray-600 mb-6 leading-relaxed">
                                        The following items in your inventory have fallen below your set threshold of
                                        <span className="font-bold text-gray-900 mx-1">₹{config.threshold} units</span>.
                                        Please restock soon to avoid running out.
                                    </p>

                                    <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6 rounded-r-lg">
                                        <div className="flex">
                                            <div className="flex-shrink-0">
                                                <AlertTriangle className="h-5 w-5 text-orange-400" />
                                            </div>
                                            <div className="ml-3">
                                                <h3 className="text-xs md:text-sm font-bold text-orange-800">Operational Impact</h3>
                                                <div className="mt-2 text-[10px] md:text-sm text-orange-700">
                                                    <p>These items account for a significant portion of your daily volume.</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden mb-6">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-3 md:px-6 py-3 text-left text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wider">Product</th>
                                                    <th className="px-3 md:px-6 py-3 text-right text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wider">Stock</th>
                                                    <th className="hidden sm:table-cell px-3 md:px-6 py-3 text-center text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                <tr>
                                                    <td className="px-3 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm font-bold text-gray-900">Maggi (Pack of 12)</td>
                                                    <td className="px-3 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-red-600 text-right font-black">2</td>
                                                    <td className="hidden sm:table-cell px-3 md:px-6 py-4 whitespace-nowrap text-center">
                                                        <span className="px-2 inline-flex text-[10px] md:text-xs leading-5 font-bold rounded-full bg-red-100 text-red-800">Critical</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="px-3 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm font-bold text-gray-900">Tata Salt (1kg)</td>
                                                    <td className="px-3 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-orange-600 text-right font-black">8</td>
                                                    <td className="hidden sm:table-cell px-3 md:px-6 py-4 whitespace-nowrap text-center">
                                                        <span className="px-2 inline-flex text-[10px] md:text-xs leading-5 font-bold rounded-full bg-orange-100 text-orange-800">Low</span>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="mt-8 text-center">
                                        <button className="w-full sm:w-auto px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs md:text-sm hover:bg-indigo-700 transition shadow-lg shadow-indigo-200">
                                            Create Purchase Order
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmailEditor;
