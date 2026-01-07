import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save, LayoutTemplate, Type, Palette, Eye, Printer, Check, Loader, QrCode, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

const BillEditor = ({ onBack, initialSettings, onSave }) => {
    const [activeTab, setActiveTab] = useState('templates');
    const [saving, setSaving] = useState(false);
    const [previewMode, setPreviewMode] = useState(initialSettings?.billFormat || '80mm');
    const [mobileView, setMobileView] = useState('config'); // 'config' or 'preview'
    const [zoom, setZoom] = useState(previewMode === 'A4' ? 60 : 100);

    const handleZoom = (type) => {
        if (type === 'in') setZoom(prev => Math.min(prev + 10, 150));
        else if (type === 'out') setZoom(prev => Math.max(prev - 10, 30));
        else setZoom(previewMode === 'A4' ? 60 : 100);
    };

    // Update zoom when switching modes for better UX
    useEffect(() => {
        if (previewMode === 'A4') setZoom(60);
        else setZoom(100);
    }, [previewMode]);

    // State for bill configuration
    const [config, setConfig] = useState({
        template: initialSettings?.template || 'standard',
        layout: initialSettings?.layout || 'standard',
        header: {
            showLogo: initialSettings?.showLogo ?? true,
            showStoreName: initialSettings?.showStoreName ?? true,
            showAddress: initialSettings?.showAddress ?? true,
            centered: true // Default internal UI state, maybe not persisted yet
        },
        colors: {
            accent: initialSettings?.accentColor || '#000000',
            text: '#000000',
            bg: '#ffffff'
        },
        footer: {
            showTerms: initialSettings?.showFooter ?? true,
            message: initialSettings?.footerMessage || "Thank you, visit again",
            terms: initialSettings?.termsAndConditions || "1. Goods once sold will not be taken back.\n2. Subject to City jurisdiction."
        }
    });

    const handleSave = async () => {
        setSaving(true);
        // Flatten config back to schema format
        const settingsToSave = {
            showHeader: true, // Assuming default true for now as 'header' implies both name/address
            showStoreName: config.header.showStoreName,
            showAddress: config.header.showAddress,
            showFooter: config.footer.showTerms,
            showLogo: config.header.showLogo,
            billFormat: previewMode,
            accentColor: config.colors.accent,
            template: config.template,
            layout: config.layout,
            footerMessage: config.footer.message,
            termsAndConditions: config.footer.terms
        };

        await onSave(settingsToSave);
        setSaving(false);
        if (window.showToast) window.showToast('Bill design saved successfully!', 'success');
    };

    // Inbuilt Templates
    const templates = [
        { id: 'standard', name: 'Standard Professional', preview: 'bg-white border-gray-300' },
        { id: 'classic', name: 'Classic Simple', preview: 'bg-yellow-50 border-double border-gray-400' },
        { id: 'modern', name: 'Modern Sleek', preview: 'bg-indigo-50 border-indigo-200' },
        { id: 'minimal', name: 'Minimalist Clean', preview: 'bg-white border-transparent' },
        { id: 'bold', name: 'Bold Business', preview: 'bg-gray-50 border-y-4 border-gray-800' }
    ];

    return (
        <div className="flex h-full flex-col bg-gray-100 dark:bg-black overflow-hidden">
            {/* Top Bar */}
            <div className="flex flex-col md:flex-row items-center justify-between bg-white dark:bg-black px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 dark:border-white/10 shadow-sm gap-4">
                <div className="flex items-center w-full md:w-auto">
                    <button onClick={onBack} className="mr-3 p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-lg md:text-xl font-bold text-gray-800 dark:text-white leading-tight">Bill Editor</h1>
                        <p className="hidden md:block text-xs text-gray-500 dark:text-slate-500">Customize layout & design</p>
                    </div>

                    {/* Mobile View Toggle */}
                    <div className="flex md:hidden ml-auto bg-gray-100 dark:bg-white/5 rounded-lg p-1">
                        <button
                            onClick={() => setMobileView('config')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mobileView === 'config' ? 'bg-white dark:bg-white/10 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-slate-500'}`}
                        >
                            EDIT
                        </button>
                        <button
                            onClick={() => setMobileView('preview')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mobileView === 'preview' ? 'bg-white dark:bg-white/10 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-slate-500'}`}
                        >
                            VIEW
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between w-full md:w-auto space-x-2 md:space-x-3">
                    <div className="flex bg-gray-100 dark:bg-white/5 rounded-lg p-1 overflow-x-auto no-scrollbar">
                        <button
                            onClick={() => setPreviewMode('80mm')}
                            className={`flex-shrink-0 px-2 md:px-3 py-1.5 text-[10px] md:text-xs font-medium rounded-md transition-all ${previewMode === '80mm' ? 'bg-white dark:bg-white/10 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'}`}
                        >
                            80mm
                        </button>
                        <button
                            onClick={() => setPreviewMode('58mm')}
                            className={`flex-shrink-0 px-2 md:px-3 py-1.5 text-[10px] md:text-xs font-medium rounded-md transition-all ${previewMode === '58mm' ? 'bg-white dark:bg-white/10 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'}`}
                        >
                            58mm
                        </button>
                        <button
                            onClick={() => setPreviewMode('A4')}
                            className={`flex-shrink-0 px-2 md:px-3 py-1.5 text-[10px] md:text-xs font-medium rounded-md transition-all ${previewMode === 'A4' ? 'bg-white dark:bg-white/10 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'}`}
                        >
                            A4
                        </button>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold text-xs md:text-sm shadow-sm transition-all transform active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {saving ? <Loader className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2 animate-spin" /> : <Save className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />}
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden relative">
                {/* Left Sidebar - Tools */}
                <div className={`${mobileView === 'config' ? 'flex' : 'hidden'} md:flex w-full md:w-80 bg-white dark:bg-black border-r border-gray-200 dark:border-white/10 flex flex-col z-10 overflow-hidden`}>
                    <div className="flex border-b border-gray-200 dark:border-white/10">
                        <button
                            onClick={() => setActiveTab('templates')}
                            className={`flex-1 py-3 md:py-4 text-xs md:text-sm font-bold border-b-2 transition-colors ${activeTab === 'templates' ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 dark:bg-indigo-600/10' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-300'}`}
                        >
                            Templates
                        </button>
                        <button
                            onClick={() => setActiveTab('design')}
                            className={`flex-1 py-3 md:py-4 text-xs md:text-sm font-bold border-b-2 transition-colors ${activeTab === 'design' ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 dark:bg-indigo-600/10' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-300'}`}
                        >
                            Design
                        </button>
                        <button
                            onClick={() => setActiveTab('content')}
                            className={`flex-1 py-3 md:py-4 text-xs md:text-sm font-bold border-b-2 transition-colors ${activeTab === 'content' ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 dark:bg-indigo-600/10' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-300'}`}
                        >
                            Content
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-hide">
                        {activeTab === 'templates' && (
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 md:mb-4">Layout Structure</h3>
                                    <div className="grid grid-cols-3 gap-2 md:gap-3">
                                        <div
                                            onClick={() => setConfig({ ...config, layout: 'standard' })}
                                            className={`cursor-pointer border rounded-lg p-2 text-center text-xs hover:bg-gray-50 dark:hover:bg-white/5 dark:text-slate-400 ${config.layout === 'standard' ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10 ring-1 ring-indigo-200 dark:ring-indigo-500/30' : 'dark:border-white/10'}`}
                                        >
                                            <div className="h-8 flex mb-1 border border-gray-200 bg-white">
                                                <div className="w-1/3 border-r bg-gray-100"></div>
                                                <div className="w-2/3"></div>
                                            </div>
                                            Standard
                                        </div>
                                        <div
                                            onClick={() => setConfig({ ...config, layout: 'centered' })}
                                            className={`cursor-pointer border rounded-lg p-2 text-center text-xs hover:bg-gray-50 dark:hover:bg-white/5 dark:text-slate-400 ${config.layout === 'centered' ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10 ring-1 ring-indigo-200 dark:ring-indigo-500/30' : 'dark:border-white/10'}`}
                                        >
                                            <div className="h-8 flex flex-col mb-1 border border-gray-200 bg-white items-center p-0.5">
                                                <div className="h-2 w-1/2 bg-gray-100 mb-1"></div>
                                                <div className="h-3 w-full border-t"></div>
                                            </div>
                                            Centered
                                        </div>
                                        <div
                                            onClick={() => setConfig({ ...config, layout: 'right' })}
                                            className={`cursor-pointer border rounded-lg p-2 text-center text-xs hover:bg-gray-50 dark:hover:bg-white/5 dark:text-slate-400 ${config.layout === 'right' ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10 ring-1 ring-indigo-200 dark:ring-indigo-500/30' : 'dark:border-white/10'}`}
                                        >
                                            <div className="h-8 flex mb-1 border border-gray-200 bg-white">
                                                <div className="w-2/3 border-r"></div>
                                                <div className="w-1/3 bg-gray-100"></div>
                                            </div>
                                            Right Align
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Style Themes</h3>
                                    {templates.map(t => (
                                        <div
                                            key={t.id}
                                            onClick={() => setConfig({ ...config, template: t.id })}
                                            className={`cursor-pointer group relative rounded-xl border-2 overflow-hidden transition-all mb-3 ${config.template === t.id ? 'border-indigo-600 ring-2 ring-indigo-100 dark:ring-indigo-500/30' : 'border-gray-200 dark:border-white/10 hover:border-indigo-300'}`}
                                        >
                                            <div className={`h-16 ${t.preview} opacity-50`}>
                                                <div className="p-3 space-y-2">
                                                    <div className="h-1.5 w-1/2 bg-current rounded opacity-20 mx-auto"></div>
                                                    <div className="space-y-1 pt-1">
                                                        <div className="h-1 w-full bg-current rounded opacity-10"></div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="p-2 bg-white dark:bg-white/5">
                                                <div className="flex justify-between items-center">
                                                    <span className="font-medium text-xs text-gray-700 dark:text-slate-300">{t.name}</span>
                                                    {config.template === t.id && <Check className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'design' && (
                            <div className="space-y-8">
                                <div>
                                    <label className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-3 block">Accent Color</label>
                                    <div className="grid grid-cols-5 gap-2">
                                        {['#000000', '#4F46E5', '#DC2626', '#16A34A', '#D97706'].map(color => (
                                            <button
                                                key={color}
                                                onClick={() => setConfig({ ...config, colors: { ...config.colors, accent: color } })}
                                                className={`w-8 h-8 rounded-full border-2 focus:outline-none focus:ring-2 ring-offset-2 ring-indigo-500 transition-transform hover:scale-110 ${config.colors.accent === color ? 'border-gray-400 scale-110 shadow-md' : 'border-transparent'}`}
                                                style={{ backgroundColor: color }}
                                            />
                                        ))}
                                        <div className="relative col-span-5 mt-2">
                                            <input
                                                type="color"
                                                value={config.colors.accent}
                                                onChange={(e) => setConfig({ ...config, colors: { ...config.colors, accent: e.target.value } })}
                                                className="w-full h-8 cursor-pointer rounded border border-gray-300 dark:border-white/10 bg-transparent"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-3 block">Font Style</label>
                                    <select className="w-full rounded-md border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm dark:text-white">
                                        <option>Helvetica (Standard)</option>
                                        <option>Courier (Monospace)</option>
                                        <option>Times New Roman (Serif)</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {activeTab === 'content' && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-lg">
                                    <div className="flex items-center">
                                        <Eye className="w-4 h-4 text-gray-500 dark:text-slate-400 mr-2" />
                                        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Show Logo</span>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={config.header.showLogo}
                                        onChange={(e) => setConfig({ ...config, header: { ...config.header, showLogo: e.target.checked } })}
                                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                    />
                                </div>

                                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-lg">
                                    <div className="flex items-center">
                                        <Printer className="w-4 h-4 text-gray-500 dark:text-slate-400 mr-2" />
                                        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Show Store Address</span>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={config.header.showAddress}
                                        onChange={(e) => setConfig({ ...config, header: { ...config.header, showAddress: e.target.checked } })}
                                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                    />
                                </div>

                                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-lg">
                                    <div className="flex items-center">
                                        <Type className="w-4 h-4 text-gray-500 dark:text-slate-400 mr-2" />
                                        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Show Footer</span>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={config.footer.showTerms}
                                        onChange={(e) => setConfig({ ...config, footer: { ...config.footer, showTerms: e.target.checked } })}
                                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                    />
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2 block">Footer Message</label>
                                    <textarea
                                        className="w-full rounded-md border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm dark:text-white"
                                        rows="2"
                                        value={config.footer.message}
                                        onChange={(e) => setConfig({ ...config, footer: { ...config.footer, message: e.target.value } })}
                                        placeholder="E.g., Thank you, visit again"
                                    />
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2 block">Terms & Conditions</label>
                                    <textarea
                                        className="w-full rounded-md border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm dark:text-white"
                                        rows="4"
                                        value={config.footer.terms}
                                        onChange={(e) => setConfig({ ...config, footer: { ...config.footer, terms: e.target.value } })}
                                        placeholder="Enter terms like: 1. No refunds..."
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Enhanced Preview Pane - Professional Studio View */}
                <div className={`${mobileView === 'preview' ? 'flex' : 'hidden'} md:flex flex-1 bg-slate-200 dark:bg-zinc-950 overflow-auto relative custom-scrollbar flex-col items-center pt-12 pb-32`}>

                    {/* Floating Zoom Controls - Repositioned to bottom for accessibility */}
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-30 flex bg-white/95 dark:bg-black/80 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.2)] rounded-2xl border border-white/50 dark:border-white/10 p-1.5 gap-1 transition-all hover:scale-105">
                        <button onClick={() => handleZoom('out')} className="p-3 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl text-slate-600 dark:text-slate-400 transition-all active:scale-90"><ZoomOut size={18} /></button>
                        <div className="flex items-center px-4 text-xs font-black text-slate-900 dark:text-white w-16 justify-center border-x border-slate-100 dark:border-white/10">{zoom}%</div>
                        <button onClick={() => handleZoom('in')} className="p-3 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl text-slate-600 dark:text-slate-400 transition-all active:scale-90"><ZoomIn size={18} /></button>
                        <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1 self-center"></div>
                        <button onClick={() => handleZoom('reset')} className="p-3 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all active:scale-90" title="Reset Zoom"><RotateCcw size={18} /></button>
                    </div>

                    {/* Uniform A4 Paper Frame */}
                    <div
                        className="transition-all duration-500 shadow-[0_45px_100px_-20px_rgba(0,0,0,0.4),0_20px_40px_-15px_rgba(0,0,0,0.2)] bg-white origin-top overflow-hidden flex flex-col items-center border border-white/50 shrink-0"
                        style={{
                            width: '210mm',
                            minHeight: '297mm',
                            transform: `scale(${zoom / 100})`,
                            transformOrigin: 'top center',
                            fontFamily: config.template === 'classic' ? 'Times New Roman, serif' : 'Inter, system-ui, -apple-system, sans-serif'
                        }}
                    >
                        {previewMode === 'A4' ? (
                            /* ================= PREMIUM A4 INVOICE ================= */
                            <div className="w-full text-slate-900 relative flex-1 flex flex-col p-[15mm]">
                                {/* Top Branding Accent */}
                                <div className="absolute top-0 left-0 right-0 h-2" style={{ backgroundColor: config.colors.accent }}></div>

                                {/* Professional Header Section */}
                                <div className="flex justify-between items-start mb-12 pt-4">
                                    <div className="flex-1">
                                        <div className="flex items-center mb-6">
                                            {config.header.showLogo && (
                                                <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center mr-4 shadow-sm">
                                                    <LayoutTemplate className="w-8 h-8 opacity-20" style={{ color: config.colors.accent }} />
                                                </div>
                                            )}
                                            <div>
                                                <h1 className="text-3xl font-black uppercase tracking-tight leading-none mb-1" style={{ color: config.colors.accent }}>
                                                    GROCERY STORE
                                                </h1>
                                                <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">Premium Retail Partner</p>
                                            </div>
                                        </div>

                                        {config.header.showAddress && (
                                            <div className="text-[11px] text-slate-500 font-medium leading-relaxed max-w-[300px] border-l-2 pl-4" style={{ borderLeftColor: `${config.colors.accent}40` }}>
                                                <p className="font-bold text-slate-700 mb-0.5">123, Central Plaza, Main Market</p>
                                                <p>West Industrial Estate, City - 400001</p>
                                                <p className="mt-1">Phone: +91 98765 43210</p>
                                                <p className="font-black text-slate-800 mt-2 tracking-wide">GSTIN: 27ABCDE1234F1Z5</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="text-right">
                                        <div className="inline-block px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg mb-6">
                                            <h2 className="text-xl font-black text-slate-900 uppercase tracking-widest">TAX INVOICE</h2>
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="flex justify-end gap-3 text-[11px]">
                                                <span className="font-bold text-slate-400 uppercase tracking-wider">Invoice No</span>
                                                <span className="font-black text-slate-900">INV-2026-00123</span>
                                            </div>
                                            <div className="flex justify-end gap-3 text-[11px]">
                                                <span className="font-bold text-slate-400 uppercase tracking-wider">Date</span>
                                                <span className="font-black text-slate-900">06 Jan 2026</span>
                                            </div>
                                            <div className="flex justify-end gap-3 text-[11px] pt-2">
                                                <span className="font-bold text-slate-400 uppercase tracking-wider">Payment</span>
                                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-black rounded uppercase text-[9px]">Paid</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Bill To Section */}
                                <div className="grid grid-cols-2 gap-10 mb-10 py-6 border-y border-slate-100">
                                    <div>
                                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Bill To</h3>
                                        <div className="text-sm">
                                            <p className="font-black text-slate-800">Walk-in Customer</p>
                                            <div className="text-[11px] text-slate-500 mt-1 font-medium italic">General Category Customer</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Place of Supply</h3>
                                        <div className="text-sm font-bold text-slate-800">
                                            Local (Within State)
                                        </div>
                                    </div>
                                </div>

                                {/* Premium Table Layout */}
                                <div className="flex-1">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="text-white" style={{ backgroundColor: config.colors.accent }}>
                                                <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider rounded-tl-lg">#</th>
                                                <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider">Item Description</th>
                                                <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-center">Qty</th>
                                                <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-right">Rate</th>
                                                <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-right">GST %</th>
                                                <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-right rounded-tr-lg">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {[
                                                { name: "Premium Basmati Rice - 5kg Pack", rate: 500, qty: 1, gst: 5 },
                                                { name: "Refined White Sugar - 1kg", rate: 40, qty: 2, gst: 0 },
                                                { name: "Fortified Sunflower Oil - 1L", rate: 150, qty: 1, gst: 5 }
                                            ].map((item, i) => {
                                                const total = item.rate * item.qty;
                                                return (
                                                    <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                                                        <td className="py-3.5 px-4 text-[11px] font-bold text-slate-400">{i + 1}</td>
                                                        <td className="py-3.5 px-4">
                                                            <div className="text-[12px] font-black text-slate-800">{item.name}</div>
                                                            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">HSN: 1001 • CGST+SGST</div>
                                                        </td>
                                                        <td className="py-3.5 px-4 text-[11px] font-black text-slate-800 text-center">{item.qty.toFixed(2)}</td>
                                                        <td className="py-3.5 px-4 text-[11px] font-bold text-slate-800 text-right">{item.rate.toFixed(2)}</td>
                                                        <td className="py-3.5 px-4 text-[11px] font-bold text-slate-500 text-right">{item.gst}%</td>
                                                        <td className="py-3.5 px-4 text-[12px] font-black text-slate-900 text-right">₹{total.toFixed(2)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Professional Totals & Footer */}
                                <div className="mt-8 pt-8 border-t-2 border-slate-100">
                                    <div className="flex justify-between items-start">
                                        <div className="max-w-[400px]">
                                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Terms & Conditions</h4>
                                            <div className="text-[10px] text-slate-500 font-medium leading-relaxed italic whitespace-pre-line p-4 bg-slate-50 rounded-xl border border-slate-100">
                                                {config.footer.terms}
                                            </div>
                                            <div className="mt-6 flex items-center gap-4 text-slate-400">
                                                <QrCode size={40} className="opacity-10" />
                                                <div className="text-[9px] font-bold uppercase tracking-widest leading-none">
                                                    Scan to verify<br />
                                                    digital invoice
                                                </div>
                                            </div>
                                        </div>

                                        <div className="w-72 space-y-3">
                                            <div className="flex justify-between text-xs py-1">
                                                <span className="font-bold text-slate-400 uppercase">Sub Total</span>
                                                <span className="font-black text-slate-800">₹721.43</span>
                                            </div>
                                            <div className="flex justify-between text-xs py-1">
                                                <span className="font-bold text-slate-400 uppercase">Tax (GST)</span>
                                                <span className="font-black text-slate-800">₹8.57</span>
                                            </div>
                                            <div className="flex justify-between text-lg pt-4 border-t-2 border-slate-900">
                                                <span className="font-black text-slate-900 uppercase italic tracking-tighter">Grand Total</span>
                                                <span className="font-black text-slate-900" style={{ color: config.colors.accent }}>₹730.00</span>
                                            </div>
                                            <div className="text-right pt-2 border-t border-slate-100 mt-10">
                                                <div className="h-16 mb-2 flex items-end justify-end italic text-slate-300 font-serif opacity-30 select-none">AUTHORIZED SIGNATURE</div>
                                                <p className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Authorized Signatory</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* ================= THERMAL STRIP (CENTERED ON A4) ================= */
                            <div
                                className="bg-white border border-slate-100 shadow-sm my-10"
                                style={{
                                    width: previewMode === '58mm' ? '58mm' : '80mm',
                                    minHeight: '200mm',
                                    padding: '8mm',
                                    fontFamily: 'monospace',
                                    fontSize: previewMode === '58mm' ? '11px' : '13px',
                                    color: '#1e293b'
                                }}
                            >
                                {/* Header */}
                                <div className="text-center space-y-1 mb-4">
                                    <div className="font-normal text-[0.8em]">TAX INVOICE</div>

                                    {config.header.showStoreName && (
                                        <div className="font-bold text-[1.2em] leading-tight" style={{ color: config.colors.accent }}>
                                            GROCERY STORE
                                        </div>
                                    )}

                                    {config.header.showAddress && (
                                        <div className="font-bold text-[0.8em] leading-tight mt-1">
                                            123, Main Market, City<br />
                                            Contact: 9876543210<br />
                                            GSTIN : 27ABCDE1234F1Z5
                                        </div>
                                    )}
                                </div>

                                {/* Meta */}
                                <div className="flex justify-between text-[0.8em] mt-2 mb-1">
                                    <div>
                                        <span className="text-red-800 font-bold">Inv No </span>
                                        <span className="font-bold text-black">0001</span>
                                    </div>
                                    <div className="text-right">
                                        <span>01/01/2026</span>
                                        <div className="flex justify-end">
                                            <span className="text-red-800 font-bold mr-1">Date</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Separator */}
                                <div className="border-t border-dashed border-black my-1"></div>

                                {/* Table Header */}
                                <div className="flex font-bold text-[0.8em] mb-1">
                                    <div className="w-[10%]">Sl</div>
                                    <div className="w-[40%]">Item</div>
                                    <div className="w-[15%] text-right">Qty</div>
                                    <div className="w-[15%] text-right">Price</div>
                                    <div className="w-[20%] text-right">Amt</div>
                                </div>

                                <div className="border-t border-dashed border-black my-1"></div>

                                {/* Items */}
                                <div className="space-y-1 font-bold text-[0.8em]">
                                    {[
                                        { name: "Sugar (1kg)", rate: 40, qty: 2, total: 80 },
                                        { name: "Rice Premium (5kg)", rate: 500, qty: 1, total: 500 },
                                        { name: "Tea Packet 250g", rate: 120, qty: 2, total: 240 }
                                    ].map((item, i) => (
                                        <div key={i} className="flex flex-wrap">
                                            <div className="w-[10%]">{i + 1}</div>
                                            <div className="w-[40%] break-words pr-1">{item.name}</div>
                                            <div className="w-[15%] text-right">{item.qty.toFixed(2)}</div>
                                            <div className="w-[15%] text-right">{item.rate.toFixed(2)}</div>
                                            <div className="w-[20%] text-right">{item.total.toFixed(2)}</div>
                                        </div>
                                    ))}
                                </div>

                                <div className="border-t border-dashed border-black my-2"></div>

                                {/* Totals */}
                                <div className="font-bold text-[0.9em] space-y-1">
                                    <div className="flex justify-between">
                                        <span>Total Item(s): 3</span>
                                        <div className="text-center flex-1">Qty.: 5.00</div>
                                        <span className="text-right">820.00</span>
                                    </div>
                                </div>

                                <div className="border-t border-dashed border-black my-2"></div>

                                {/* Grand Total */}
                                <div className="flex justify-between font-bold text-[1.2em] my-2">
                                    <span>Total Amount</span>
                                    <div className="text-right">820.00</div>
                                </div>

                                <div className="border-t border-dashed border-black my-2"></div>

                                {/* Footer */}
                                {config.footer.showTerms && (
                                    <div className="text-center space-y-2">
                                        <div className="font-bold text-[1em]">Terms and Conditions</div>
                                        <div className="text-[0.7em] leading-tight space-y-1 whitespace-pre-line text-left px-2 border border-dashed border-gray-200 p-2 rounded">
                                            {config.footer.terms}
                                        </div>
                                        {config.footer.message && (
                                            <div className="text-[0.8em] font-black pt-2 text-indigo-600">
                                                {config.footer.message}
                                            </div>
                                        )}
                                        <div className="font-bold text-[1em] mt-2 tracking-widest text-gray-400 italic">*** Thank You ***</div>
                                    </div>
                                )}

                                {/* QR Code Placeholder */}
                                <div className="flex flex-col items-center mt-6 pt-4 border-t border-gray-100">
                                    <div className="w-24 h-24 bg-gray-50 border border-gray-200 flex items-center justify-center rounded-xl p-2 transition-transform hover:scale-105 active:scale-95 cursor-pointer shadow-sm">
                                        <QrCode className="w-full h-full text-indigo-600" />
                                    </div>
                                    <span className="text-[0.6em] font-black tracking-widest text-slate-400 mt-2">SCAN TO PAY</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div >
    );
};

export default BillEditor;
