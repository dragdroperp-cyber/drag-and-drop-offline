import React, { useState } from 'react';
import {
    ArrowLeft,
    Save,
    BarChart3,
    Receipt,
    Palette,
    Download,
    Loader,
    ZoomIn,
    ZoomOut,
    RotateCcw,
    Layout,
    Type,
    Eye
} from 'lucide-react';

const ReportEditor = ({ onBack, initialSettings, onSave }) => {
    const [saving, setSaving] = useState(false);
    const [mobileView, setMobileView] = useState('config');
    const [selectedReport, setSelectedReport] = useState('sales');
    const [zoom, setZoom] = useState(85);
    const [config, setConfig] = useState({
        includeCharts: initialSettings?.includeCharts ?? true,
        chartType: initialSettings?.chartType || 'bar',
        themeColor: initialSettings?.themeColor || '#2F3C7E', // Default blue from Reports.js
        density: initialSettings?.density || 'comfortable',
        showSummary: initialSettings?.showSummary ?? true,
        showAddress: initialSettings?.showAddress ?? true,
        orientation: initialSettings?.orientation || 'landscape', // Default from Reports.js
        columns: initialSettings?.columns || ['section', 'metric', 'value']
    });

    const reportTypes = [
        { id: 'sales', label: 'Sales Summary', icon: BarChart3 },
        { id: 'general', label: 'General Report', icon: Receipt },
        { id: 'inventory', label: 'Inventory Status', icon: Palette }
    ];

    const toggleColumn = (colId) => {
        setConfig(prev => ({
            ...prev,
            columns: prev.columns.includes(colId)
                ? prev.columns.filter(c => c !== colId)
                : [...prev.columns, colId]
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        const settingsToSave = {
            ...config,
            defaultDateRange: initialSettings?.defaultDateRange || 'month',
            exportFormat: 'pdf'
        };

        await onSave(settingsToSave);
        setSaving(false);
        if (window.showToast) window.showToast('PDF Report settings saved!', 'success');
    }

    const handleZoom = (type) => {
        if (type === 'in') setZoom(prev => Math.min(prev + 10, 150));
        else if (type === 'out') setZoom(prev => Math.max(prev - 10, 30));
        else setZoom(85);
    };

    return (
        <div className="flex h-full flex-col bg-slate-100/50 dark:bg-black overflow-hidden">
            {/* Top Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between bg-white dark:bg-black px-4 md:px-6 py-3 border-b border-slate-200 dark:border-white/10 gap-4 z-10">
                <div className="flex items-center w-full md:w-auto">
                    <button onClick={onBack} className="mr-3 p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                        <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">Report PDF Customization</h1>
                        <p className="hidden md:block text-[11px] text-slate-500 dark:text-slate-500 font-medium">Match your digital reports with your brand identity</p>
                    </div>

                    {/* Mobile View Toggle */}
                    <div className="flex md:hidden ml-auto bg-slate-100 dark:bg-white/5 rounded-lg p-1">
                        <button onClick={() => setMobileView('config')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${mobileView === 'config' ? 'bg-white dark:bg-white/10 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-500'}`}>Edit</button>
                        <button onClick={() => setMobileView('preview')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${mobileView === 'preview' ? 'bg-white dark:bg-white/10 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-500'}`}>Preview</button>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 md:flex-none px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold text-sm shadow-lg shadow-indigo-100 flex items-center justify-center disabled:opacity-50 transition-all active:scale-95"
                    >
                        {saving ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden relative">
                {/* Sidebar - Settings */}
                <div className={`${mobileView === 'config' ? 'block' : 'hidden'} md:block w-full md:w-80 bg-white dark:bg-black border-r border-slate-200 dark:border-white/10 overflow-y-auto custom-scrollbar`}>
                    <div className="p-6 space-y-8">
                        {/* Orientation */}
                        <section>
                            <label className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">
                                <Layout className="w-3.5 h-3.5 mr-2" /> Page Orientation
                            </label>
                            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                                <button
                                    onClick={() => setConfig({ ...config, orientation: 'portrait' })}
                                    className={`py-2 text-[11px] font-bold rounded-lg transition-all ${config.orientation === 'portrait' ? 'bg-white dark:bg-white/10 shadow-sm text-indigo-600 dark:text-indigo-400 ring-1 ring-slate-200 dark:ring-white/10' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                >Portrait</button>
                                <button
                                    onClick={() => setConfig({ ...config, orientation: 'landscape' })}
                                    className={`py-2 text-[11px] font-bold rounded-lg transition-all ${config.orientation === 'landscape' ? 'bg-white dark:bg-white/10 shadow-sm text-indigo-600 dark:text-indigo-400 ring-1 ring-slate-200 dark:ring-white/10' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                >Landscape</button>
                            </div>
                        </section>

                        {/* Theme Color */}
                        <section>
                            <label className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">
                                <Palette className="w-3.5 h-3.5 mr-2" /> Branding Color
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="color"
                                    value={config.themeColor}
                                    onChange={e => setConfig({ ...config, themeColor: e.target.value })}
                                    className="w-12 h-12 rounded-xl cursor-pointer bg-transparent border-0 ring-4 ring-slate-50 dark:ring-white/5"
                                />
                                <div className="flex-1">
                                    <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 uppercase bg-slate-50 dark:bg-white/5 px-3 py-2 rounded-lg border border-slate-100 dark:border-white/10">{config.themeColor}</div>
                                </div>
                            </div>
                        </section>

                        {/* Visibility */}
                        <section>
                            <label className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">
                                <Eye className="w-3.5 h-3.5 mr-2" /> Visible Elements
                            </label>
                            <div className="space-y-3">
                                {[
                                    { id: 'showSummary', label: 'Summary Section' },
                                    { id: 'includeCharts', label: 'Analytics Charts' },
                                    { id: 'showAddress', label: 'Store Address Info' }
                                ].map(item => (
                                    <label key={item.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-colors group">
                                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">{item.label}</span>
                                        <input
                                            type="checkbox"
                                            checked={config[item.id]}
                                            onChange={e => setConfig({ ...config, [item.id]: e.target.checked })}
                                            className="w-5 h-5 rounded-lg text-indigo-600 dark:text-indigo-400 focus:ring-0 cursor-pointer bg-white dark:bg-white/10 border-slate-300 dark:border-white/20"
                                        />
                                    </label>
                                ))}
                            </div>
                        </section>

                        {/* Density */}
                        <section>
                            <label className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">
                                <Type className="w-3.5 h-3.5 mr-2" /> Table Density
                            </label>
                            <select
                                value={config.density}
                                onChange={e => setConfig({ ...config, density: e.target.value })}
                                className="w-full bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-white/10 rounded-xl text-xs font-bold py-3 px-4 focus:ring-indigo-500 transition-all dark:text-white"
                            >
                                <option value="comfortable">Comfortable (Safe)</option>
                                <option value="compact">Compact (More Data)</option>
                            </select>
                        </section>
                    </div>
                </div>

                {/* Preview Pane */}
                <div className={`${mobileView === 'preview' ? 'flex' : 'hidden'} md:flex flex-1 bg-slate-200/80 dark:bg-zinc-950 items-center justify-center p-4 md:p-8 overflow-auto relative custom-scrollbar`}>

                    {/* Floating Zoom Controls */}
                    <div className="absolute top-6 right-6 z-20 flex bg-white/90 dark:bg-black/80 backdrop-blur shadow-2xl rounded-2xl border border-white dark:border-white/10 p-1 gap-1">
                        <button onClick={() => handleZoom('out')} className="p-2.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl text-slate-600 dark:text-slate-400 transition-all active:scale-90"><ZoomOut size={16} /></button>
                        <div className="flex items-center px-2 text-[10px] font-black text-slate-900 dark:text-white w-12 justify-center">{zoom}%</div>
                        <button onClick={() => handleZoom('in')} className="p-2.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl text-slate-600 dark:text-slate-400 transition-all active:scale-90"><ZoomIn size={16} /></button>
                        <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1 self-center"></div>
                        <button onClick={() => handleZoom('reset')} className="p-2.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl text-slate-600 dark:text-slate-400 transition-all active:scale-90"><RotateCcw size={16} /></button>
                    </div>

                    <div
                        className="transition-all duration-500 shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] bg-white origin-top"
                        style={{
                            width: config.orientation === 'portrait' ? '210mm' : '297mm',
                            minHeight: config.orientation === 'portrait' ? '297mm' : '210mm',
                            transform: `scale(${zoom / 100})`,
                            transformOrigin: 'top center',
                            padding: '15mm',
                            marginBottom: '100px'
                        }}
                    >
                        {/* PDF Content - Mimicking Reports.js exportReportsPDF */}

                        {/* Header Bar Area */}
                        <div className="flex justify-between items-start border-b-2 pb-6 mb-8" style={{ borderColor: config.themeColor }}>
                            <div className="flex items-center">
                                {/* Mock Logo Placeholder */}
                                <div className="w-16 h-16 bg-slate-100 rounded-xl flex items-center justify-center mr-4 border border-slate-200">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Logo</span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold uppercase tracking-tight" style={{ color: config.themeColor }}>INVENTORY STUDIO</h2>
                                    {config.showAddress && (
                                        <div className="text-[9px] text-slate-400 font-medium leading-relaxed max-w-[250px]">
                                            123 Digital Marketplace, Suite 400<br />
                                            Metropolis City, 560001<br />
                                            Phone: +91 98765 43210
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="text-right">
                                <h1 className="text-lg font-black text-slate-900 uppercase tracking-widest">REPORTS SUMMARY</h1>
                                <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase mt-2">
                                    Generated: Jan 06, 2026<br />
                                    Period: Daily Report
                                </div>
                            </div>
                        </div>

                        {/* Summary Metrics Area */}
                        {config.showSummary && (
                            <div className="grid grid-cols-4 gap-4 mb-10">
                                {[
                                    { label: 'Total Sales', value: '₹4,59,200', color: config.themeColor },
                                    { label: 'Total Orders', value: '1,248', color: config.themeColor },
                                    { label: 'Net Profit', value: '₹84,320', color: '#10b981' }, // Profit Emerald
                                    { label: 'Inv items', value: '450', color: config.themeColor }
                                ].map((m, i) => (
                                    <div key={i} className="relative p-5 bg-white border border-slate-100 rounded-xl shadow-lg shadow-slate-200/50">
                                        <div className="absolute top-0 right-0 w-1.5 h-full rounded-r-xl" style={{ backgroundColor: m.color }}></div>
                                        <div className="text-[9px] font-black text-slate-400 mb-1.5 uppercase tracking-wide">{m.label}</div>
                                        <div className="text-lg font-bold text-slate-900">{m.value}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Chart Area */}
                        {config.includeCharts && (
                            <div className="mb-10 bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
                                <div className="flex justify-between items-center mb-5">
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sales & Profit Trends</h3>
                                    <div className="flex gap-4">
                                        <div className="flex items-center"><div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: config.themeColor }}></div><span className="text-[8px] font-bold text-slate-500 uppercase">Sales</span></div>
                                        <div className="flex items-center"><div className="w-2 h-2 rounded-full mr-2 bg-emerald-500"></div><span className="text-[8px] font-bold text-slate-500 uppercase">Profit</span></div>
                                    </div>
                                </div>
                                <div className="h-32 flex items-end gap-2 px-2">
                                    {[60, 40, 80, 50, 70, 90, 85, 45, 65, 55, 75, 95].map((h, i) => (
                                        <div key={i} className="flex-1 flex flex-col justify-end gap-0.5">
                                            <div className="w-full bg-emerald-500/30 rounded-t-sm" style={{ height: `${h * 0.4}%` }}></div>
                                            <div className="w-full rounded-t-sm" style={{ height: `${h}%`, backgroundColor: config.themeColor }}></div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between mt-3 text-[8px] font-bold text-slate-300 uppercase px-1">
                                    <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                                </div>
                            </div>
                        )}

                        {/* Detailed Table Section */}
                        <div className="mb-4 flex justify-between items-end border-b pb-2">
                            <h3 className="text-sm font-bold text-slate-900 border-l-4 pl-3" style={{ borderLeftColor: config.themeColor }}>Detailed Breakdown</h3>
                            <div className="text-[9px] text-slate-400 font-bold uppercase">Consolidated View</div>
                        </div>

                        <table className="w-full">
                            <thead>
                                <tr className="text-white" style={{ backgroundColor: config.themeColor }}>
                                    <th className="py-2.5 px-4 text-left text-[9px] font-black uppercase tracking-widest rounded-tl-lg">Section</th>
                                    <th className="py-2.5 px-4 text-left text-[9px] font-black uppercase tracking-widest">Metric</th>
                                    <th className="py-2.5 px-4 text-right text-[9px] font-black uppercase tracking-widest rounded-tr-lg">Value</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {[
                                    ['Sales Summary', 'Gross Sales', '₹4,59,200'],
                                    ['Sales Summary', 'Discounts', '₹12,400'],
                                    ['Sales Summary', 'Net Revenue', '₹4,46,800'],
                                    ['Finance', 'Tax Collected', '₹82,656'],
                                    ['Finance', 'Net Profit', '₹84,320'],
                                    ['Inventory', 'Total Products', '12,480'],
                                    ['Inventory', 'Low Stock', '23 items']
                                ].map((row, idx) => (
                                    <tr key={idx} className={`${idx % 2 === 1 ? 'bg-slate-50/50' : ''} ${config.density === 'compact' ? 'h-8' : 'h-12'} transition-colors`}>
                                        <td className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-tight">{row[0]}</td>
                                        <td className="px-4 text-[10px] font-bold text-slate-700">{row[1]}</td>
                                        <td className="px-4 text-[10px] font-black text-right" style={{ color: idx === 4 ? '#10b981' : config.themeColor }}>{row[2]}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* Footer Section */}
                        <div className="mt-12 pt-4 border-t border-slate-100 flex justify-between items-center">
                            <div className="text-[8px] font-bold text-slate-300 uppercase tracking-widest">Generated via Inventory Studio Cloud</div>
                            <div className="text-[8px] font-bold text-slate-300 uppercase tracking-widest">Page 1 of 1</div>
                        </div>
                    </div>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
            `}} />
        </div>
    );
};

export default ReportEditor;
