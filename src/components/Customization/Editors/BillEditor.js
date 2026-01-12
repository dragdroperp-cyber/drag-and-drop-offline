import React, { useState, useEffect, useRef } from 'react';
import {
    ArrowLeft, Save, LayoutTemplate, Type, Palette, Eye, Printer,
    Check, Loader, QrCode as QrCodeIcon, ZoomIn, ZoomOut, RotateCcw,
    ChevronDown, ChevronRight, MousePointer2, Move, GripVertical,
    FileText, Layers, Image as ImageIcon, CheckCircle2, X
} from 'lucide-react';
import QRCode from 'qrcode';

const BillEditor = ({ onBack, initialSettings, onSave }) => {
    // Editor State
    const [activeTool, setActiveTool] = useState('templates');
    const [saving, setSaving] = useState(false);
    const [previewMode, setPreviewMode] = useState(initialSettings?.billFormat || '80mm');
    const [zoom, setZoom] = useState(100);
    const [isPanelExpanded, setIsPanelExpanded] = useState(true);
    const [dummyQrCode, setDummyQrCode] = useState(null);

    // Settings State
    const [config, setConfig] = useState({
        template: initialSettings?.template || 'standard',
        layout: initialSettings?.layout || 'standard',
        header: {
            showLogo: initialSettings?.showLogo ?? true,
            showStoreName: initialSettings?.showStoreName ?? true,
            showAddress: initialSettings?.showAddress ?? true,
            title: "TAX INVOICE"
        },
        colors: {
            accent: initialSettings?.accentColor || '#000000',
            bg: '#ffffff'
        },
        footer: {
            showTerms: initialSettings?.showFooter ?? true,
            message: initialSettings?.footerMessage || "Thank you, visit again",
            terms: initialSettings?.termsAndConditions || "1. Goods once sold will not be taken back.\n2. Subject to City jurisdiction."
        }
    });

    const containerRef = useRef(null);
    const panelRef = useRef(null);
    const [touchStartY, setTouchStartY] = useState(null);

    // Generate Dummy QR Code
    useEffect(() => {
        const generateQR = async () => {
            try {
                // Generates a QR code similar to what appears on payment
                const url = await QRCode.toDataURL('upi://pay?pa=demo@upi&pn=GroceryStore&am=0.00', {
                    margin: 0,
                    width: 150,
                    color: {
                        dark: '#000000',
                        light: '#ffffff'
                    }
                });
                setDummyQrCode(url);
            } catch (err) {
                console.error("QR Gen Error", err);
            }
        };
        generateQR();
    }, []);

    // Auto-fit zoom on load
    useEffect(() => {
        if (containerRef.current) {
            const viewHeight = containerRef.current.clientHeight;
            const billHeightKb = previewMode === 'A4' ? 1000 : 600;
            const initialZoom = Math.min(100, (viewHeight / billHeightKb) * 90);
            setZoom(Math.max(40, initialZoom));
        }
    }, [previewMode]);

    // Handle Panel Interaction
    const handleActiveToolChange = (toolId) => {
        if (activeTool === toolId && isPanelExpanded) {
            setIsPanelExpanded(false);
        } else {
            setActiveTool(toolId);
            setIsPanelExpanded(true);
        }
    };

    const handleTouchStart = (e) => {
        setTouchStartY(e.touches[0].clientY);
    };

    const handleTouchMove = (e) => {
        if (touchStartY === null) return;

        const currentY = e.touches[0].clientY;
        const diff = currentY - touchStartY;

        // Swipe Down -> Close
        if (diff > 50 && isPanelExpanded) {
            setIsPanelExpanded(false);
            setTouchStartY(null);
        }
        // Swipe Up -> Open
        else if (diff < -50 && !isPanelExpanded) {
            setIsPanelExpanded(true);
            setTouchStartY(null);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        const settingsToSave = {
            showHeader: true,
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

    // --- Configuration Constants ---

    // Tools Menu - Simplified
    const TOOLS = [
        { id: 'templates', label: 'Templates', icon: LayoutTemplate },
        { id: 'style', label: 'Styles', icon: Palette },
        { id: 'header', label: 'Header', icon: ImageIcon },
        { id: 'content', label: 'Content', icon: Layers },
        { id: 'footer', label: 'Footer', icon: FileText },
        { id: 'size', label: 'Size', icon: Printer },
    ];

    // Templates List
    const TEMPLATES = [
        { id: 'standard', name: 'Standard', class: 'bg-white border-gray-200' },
        { id: 'classic', name: 'Classic', class: 'bg-stone-50 border-double border-stone-300 font-serif' },
        { id: 'modern', name: 'Modern', class: 'bg-slate-50 border-slate-200' },
        { id: 'minimal', name: 'Minimal', class: 'bg-white border-transparent' },
        { id: 'bold', name: 'Bold', class: 'bg-gray-50 border-y-4 border-gray-900' }
    ];

    // Colors
    const COLORS = ['#000000', '#4F46E5', '#DC2626', '#16A34A', '#EAB308', '#DB2777', '#7C3AED', '#2563EB'];

    // --- Components ---

    const ActiveToolPanel = () => {
        switch (activeTool) {
            case 'templates':
                return (
                    <div className="flex gap-3 overflow-x-auto pb-6 pt-2 no-scrollbar px-4">
                        {TEMPLATES.map(t => (
                            <div
                                key={t.id}
                                onClick={() => setConfig({ ...config, template: t.id })}
                                className={`
                                    flex flex-col items-center gap-2 cursor-pointer min-w-[85px] flex-shrink-0 group
                                `}
                            >
                                <div className={`
                                    w-20 h-28 rounded-xl border-2 shadow-sm transition-all overflow-hidden relative
                                    ${config.template === t.id ? 'border-indigo-500 ring-4 ring-indigo-500/20 scale-105' : 'border-zinc-700 opacity-60 group-hover:opacity-100'}
                                    bg-zinc-800
                                `}>
                                    <div className={`w-full h-full p-2 origin-top transform scale-50 ${t.class} text-[8px]`}>
                                        <div className="h-2 w-1/2 bg-current opacity-20 mb-2 rounded-sm" />
                                        <div className="space-y-1">
                                            <div className="h-1 w-full bg-current opacity-10 rounded-sm" />
                                            <div className="h-1 w-full bg-current opacity-10 rounded-sm" />
                                            <div className="h-1 w-3/4 bg-current opacity-10 rounded-sm" />
                                        </div>
                                    </div>
                                    {config.template === t.id && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
                                            <div className="bg-indigo-600 rounded-full p-1 shadow-lg">
                                                <Check size={12} className="text-white" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <span className={`text-[10px] font-medium ${config.template === t.id ? 'text-indigo-400' : 'text-gray-400'}`}>{t.name}</span>
                            </div>
                        ))}
                    </div>
                );

            case 'style':
                return (
                    <div className="space-y-4 px-4 pb-4 w-full max-w-4xl mx-auto">
                        <div className="flex flex-col gap-4">
                            <div>
                                <span className="text-[10px] text-gray-400 uppercase font-bold mb-2 block pl-1">Alignment</span>
                                <div className="flex bg-zinc-800 p-1 rounded-lg">
                                    {[
                                        { id: 'standard', label: 'Left' },
                                        { id: 'centered', label: 'Center' },
                                        { id: 'right', label: 'Right' }
                                    ].map(opt => (
                                        <button
                                            key={opt.id}
                                            onClick={() => setConfig({ ...config, layout: opt.id })}
                                            className={`flex-1 px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${config.layout === opt.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-zinc-700'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <span className="text-[10px] text-gray-400 uppercase font-bold mb-2 block pl-1">Brand Color</span>
                                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 px-1">
                                    {COLORS.map(color => (
                                        <button
                                            key={color}
                                            onClick={() => setConfig({ ...config, colors: { ...config.colors, accent: color } })}
                                            className={`
                                                w-8 h-8 rounded-full flex-shrink-0 border-2 transition-all flex items-center justify-center
                                                ${config.colors.accent === color ? 'border-indigo-400 scale-110 ring-2 ring-indigo-400/30' : 'border-transparent hover:scale-110'}
                                            `}
                                            style={{ backgroundColor: color }}
                                        >
                                            {config.colors.accent === color && <Check size={14} className="text-white drop-shadow-md" />}
                                        </button>
                                    ))}
                                    <div className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 flex-shrink-0 border-2 border-white/20 flex items-center justify-center cursor-pointer overflow-hidden hover:scale-110 transition-transform">
                                        <input
                                            type="color"
                                            value={config.colors.accent}
                                            onChange={(e) => setConfig({ ...config, colors: { ...config.colors, accent: e.target.value } })}
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                        />
                                        <span className="text-white font-bold text-[10px]">+</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case 'header':
                return (
                    <div className="w-full max-w-4xl mx-auto px-4 pb-4">
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { key: 'showLogo', label: 'Show Logo' },
                                { key: 'showStoreName', label: 'Store Name' },
                                { key: 'showAddress', label: 'Show Address' }
                            ].map(item => (
                                <button
                                    key={item.key}
                                    onClick={() => setConfig({ ...config, header: { ...config.header, [item.key]: !config.header[item.key] } })}
                                    className={`
                                        flex items-center justify-between p-3 rounded-xl border transition-all text-left
                                        ${config.header[item.key]
                                            ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-100'
                                            : 'bg-zinc-800/50 border-zinc-700 text-gray-400 hover:bg-zinc-800'
                                        }
                                    `}
                                >
                                    <span className="text-xs font-bold">{item.label}</span>
                                    <div className={`w-8 h-4 rounded-full transition-colors relative ${config.header[item.key] ? 'bg-indigo-500' : 'bg-zinc-600'}`}>
                                        <div className={`absolute top-0.5 left-0.5 bg-white w-3 h-3 rounded-full transition-transform ${config.header[item.key] ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                );

            case 'footer':
                return (
                    <div className="space-y-4 px-4 pb-4 w-full max-w-4xl mx-auto">
                        <div className="flex items-center justify-between bg-zinc-800/50 p-3 rounded-xl border border-zinc-700">
                            <span className="text-xs font-bold text-gray-300">Enable Footer</span>
                            <button
                                onClick={() => setConfig({ ...config, footer: { ...config.footer, showTerms: !config.footer.showTerms } })}
                                className={`w-8 h-4 rounded-full transition-colors relative ${config.footer.showTerms ? 'bg-indigo-600' : 'bg-zinc-600'}`}
                            >
                                <div className={`absolute top-0.5 left-0.5 bg-white w-3 h-3 rounded-full transition-transform ${config.footer.showTerms ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        {config.footer.showTerms && (
                            <div className="space-y-3 animate-in slide-in-from-bottom-2 fade-in duration-300">
                                <div>
                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1.5 block pl-1">Thank You Message</label>
                                    <input
                                        type="text"
                                        value={config.footer.message}
                                        onChange={(e) => setConfig({ ...config, footer: { ...config.footer, message: e.target.value } })}
                                        className="w-full bg-zinc-800 border-none rounded-lg p-3 text-xs text-white focus:ring-1 focus:ring-indigo-500 placeholder-zinc-600"
                                        placeholder="Enter footer message..."
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1.5 block pl-1">Terms & Conditions</label>
                                    <textarea
                                        rows={2}
                                        value={config.footer.terms}
                                        onChange={(e) => setConfig({ ...config, footer: { ...config.footer, terms: e.target.value } })}
                                        className="w-full bg-zinc-800 border-none rounded-lg p-3 text-xs text-white focus:ring-1 focus:ring-indigo-500 placeholder-zinc-600 resize-none"
                                        placeholder="Enter terms..."
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                );

            case 'content':
                return (
                    <div className="px-4 py-6 text-center text-gray-500">
                        <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-2 text-zinc-600">
                            <Layers size={20} />
                        </div>
                        <p className="text-xs">Dynamic content managed by system.</p>
                    </div>
                );

            case 'size':
                return (
                    <div className="flex justify-center gap-3 py-4 w-full overflow-x-auto no-scrollbar px-4">
                        {['80mm', '58mm', 'A4'].map(fmt => (
                            <button
                                key={fmt}
                                onClick={() => setPreviewMode(fmt)}
                                className={`
                                    flex flex-col items-center justify-center w-20 h-24 rounded-xl border-2 transition-all gap-1.5 flex-shrink-0
                                    ${previewMode === fmt ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-[0_0_15px_rgba(99,102,241,0.25)]' : 'border-zinc-700 bg-zinc-800/50 text-gray-400 hover:bg-zinc-800 hover:border-zinc-500'}
                                `}
                            >
                                <div className={`w-6 bg-current opacity-50 rounded-sm mb-1 ${fmt === 'A4' ? 'h-10' : 'h-8'}`} />
                                <span className="text-xs font-bold">{fmt}</span>
                            </button>
                        ))}
                    </div>
                );

            default: return null;
        }
    };

    return (
        <div className="fixed inset-0 bg-black text-white overflow-hidden font-sans z-[100] flex flex-col items-center justify-center">

            {/* 1. TOP BAR (Floating) */}
            <div className="absolute top-0 left-0 right-0 p-4 z-50 flex items-center justify-between pointer-events-none">
                <button onClick={onBack} className="pointer-events-auto w-9 h-9 flex items-center justify-center bg-black/40 backdrop-blur-md rounded-full text-white border border-white/10 hover:bg-black/60 transition-all">
                    <ArrowLeft size={18} />
                </button>

                <div className="pointer-events-auto flex items-center gap-3">
                    <div className="px-3 py-1 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-[10px] font-bold text-zinc-300 hidden sm:block">
                        {Math.round(zoom)}% Scale
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-1.5 bg-white text-black rounded-full text-xs font-bold shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-70 disabled:scale-100"
                    >
                        {saving ? <Loader size={12} className="animate-spin" /> : 'Save'}
                    </button>
                </div>
            </div>

            {/* 2. MAIN PREVIEW CANVAS - NEW EXACT LAYOUT from Screenshot */}
            <div className="absolute inset-0 z-0 flex items-center justify-center bg-[#050505]" ref={containerRef}>
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-20 pointer-events-none"
                    style={{
                        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)',
                        backgroundSize: '40px 40px'
                    }}>
                </div>

                {/* Scrollable Container */}
                <div className={`w-full h-full overflow-auto flex items-center justify-center p-8 custom-scrollbar transition-all duration-300 ${isPanelExpanded ? 'pb-[350px]' : 'pb-32'}`}>
                    <div
                        className="relative shadow-[0_0_100px_rgba(0,0,0,0.8)] transition-all duration-300 ease-out origin-center bg-white text-black"
                        style={{
                            width: previewMode === 'A4' ? '210mm' : (previewMode === '58mm' ? '58mm' : '80mm'),
                            minHeight: previewMode === 'A4' ? '297mm' : 'auto',
                            transform: `scale(${zoom / 100})`,
                            fontFamily: 'Arial, sans-serif' // Explicit standard font
                        }}
                    >
                        <div className={`p-4 ${previewMode === 'A4' ? 'p-12' : ''} h-full flex flex-col`}>

                            {/* Header Section */}
                            <div className="text-center mb-2">
                                {/* Logo Rendering */}
                                {config.header.showLogo && (
                                    <div className="flex justify-center mb-2">
                                        {initialSettings?.logoUrl ? (
                                            <img
                                                src={initialSettings.logoUrl}
                                                alt="Store Logo"
                                                className="h-12 object-contain grayscale"
                                            />
                                        ) : (
                                            <div className="h-10 w-10 border border-black rounded flex items-center justify-center bg-gray-100/50">
                                                <ImageIcon size={20} className="opacity-50 text-black" />
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="text-sm font-bold uppercase tracking-tight">{config.header.title}</div>
                                {config.header.showStoreName && (
                                    <div className="text-lg font-bold mt-1 text-black">scmodi9's Store</div>
                                )}
                            </div>

                            {/* Meta Info */}
                            <div className="flex justify-between items-center text-[11px] font-bold mb-1">
                                <span>Inv No INV-7qXCZUIc</span>
                                <span>Date 9/1/2026</span>
                            </div>

                            {/* Dashed Separator */}
                            <div className="border-b border-dashed border-black my-1 opacity-80"></div>

                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-1 text-[10px] font-bold uppercase py-0.5">
                                <div className="col-span-1">Sl.No.</div>
                                <div className="col-span-4">Item Name</div>
                                <div className="col-span-2 text-right">QTY.</div>
                                <div className="col-span-2 text-right">Price</div>
                                <div className="col-span-3 text-right">Amount</div>
                            </div>

                            {/* Dashed Separator */}
                            <div className="border-b border-dashed border-black my-1 opacity-80"></div>

                            {/* Items */}
                            <div className="text-[10px] font-bold space-y-1">
                                <div className="grid grid-cols-12 gap-1 py-0.5">
                                    <div className="col-span-1">1</div>
                                    <div className="col-span-4 truncate">regtry5rsd</div>
                                    <div className="col-span-2 text-right">1.00</div>
                                    <div className="col-span-2 text-right">7.00</div>
                                    <div className="col-span-3 text-right">7.00</div>
                                </div>
                            </div>

                            {/* Dashed Separator */}
                            <div className="border-b border-dashed border-black my-1 opacity-80 mt-2"></div>

                            {/* Summary Line 1 */}
                            <div className="flex justify-between items-center text-[10px] font-bold py-0.5">
                                <div className="flex gap-4">
                                    <span>Total Item(s): 1</span>
                                    <span>Qty.: 1.00</span>
                                </div>
                                <span>7.00</span>
                            </div>

                            {/* Dashed Separator */}
                            <div className="border-b border-dashed border-black my-1 opacity-80"></div>

                            {/* Grand Total */}
                            <div className="flex justify-between items-center py-1">
                                <span className="text-2xl font-bold tracking-tight">Total</span>
                                <span className="text-2xl font-bold tracking-tight">7.00</span>
                            </div>

                            {/* Dashed Separator */}
                            <div className="border-b border-dashed border-black my-1 opacity-80 mb-2"></div>

                            {/* Terms Section */}
                            {config.footer.showTerms && (
                                <div className="text-center mt-2">
                                    <div className="text-sm font-bold mb-2">Terms and Conditions</div>
                                    <div className="text-[10px] font-bold whitespace-pre-wrap leading-tight">
                                        {config.footer.message || "Thank you, visit again"}
                                    </div>
                                    <div className="text-[10px] font-bold mt-2">Thank You</div>
                                </div>
                            )}

                            {/* QR Code */}
                            {dummyQrCode && (
                                <div className="flex flex-col items-center mt-4">
                                    <img src={dummyQrCode} alt="Pay" className="w-24 h-24 mix-blend-multiply" />
                                    <span className="text-[10px] font-bold mt-1">Scan to Pay</span>
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            </div>

            {/* 3. BOTTOM CONTROL PANEL (Slidable/Foldable) */}
            <div
                ref={panelRef}
                className={`
                    absolute bottom-0 left-0 right-0 z-40 bg-[#121212] border-t border-white/10 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] 
                    transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
                    ${isPanelExpanded ? 'translate-y-0' : 'translate-y-[calc(100%-70px)]'}
                `}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
            >
                {/* Drag Handle */}
                <div
                    className="flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing w-full"
                    onClick={() => setIsPanelExpanded(!isPanelExpanded)}
                >
                    <div className="w-8 h-1 bg-white/20 rounded-full mb-1"></div>
                </div>

                {/* Content Container (Masked when folded) */}
                <div className={`transition-opacity duration-300 ${isPanelExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>

                    {/* Dynamic Tool Content */}
                    <div className="min-h-[160px] max-h-[40vh] overflow-y-auto custom-scrollbar pt-1 pb-4">
                        <div className="flex justify-between px-4 mb-3 items-center">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">{TOOLS.find(t => t.id === activeTool)?.label}</span>
                            <button onClick={() => setIsPanelExpanded(false)} className="p-1 rounded-full bg-zinc-800 hover:bg-zinc-700">
                                <ChevronDown size={12} className="text-gray-400" />
                            </button>
                        </div>
                        <ActiveToolPanel />
                    </div>
                </div>

                {/* Main Tabs (Fixed at bottom of panel) */}
                <div className="border-t border-white/5 bg-black/40 backdrop-blur-md pb-safe">
                    <div className="flex overflow-x-auto no-scrollbar py-2 px-2 gap-0.5 items-center snap-x">
                        {TOOLS.map(tool => {
                            const Icon = tool.icon;
                            const isActive = activeTool === tool.id;
                            return (
                                <button
                                    key={tool.id}
                                    onClick={() => handleActiveToolChange(tool.id)}
                                    className={`
                                        flex flex-col items-center justify-center gap-1 p-2.5 min-w-[65px] rounded-xl transition-all flex-shrink-0 snap-center
                                        ${isActive ? 'text-white' : 'text-zinc-500 hover:text-white'}
                                    `}
                                >
                                    <div className={`p-1 rounded-lg transition-all ${isActive ? 'bg-white text-black' : ''}`}>
                                        <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                                    </div>
                                    <span className={`text-[9px] font-bold tracking-wide leading-none ${isActive ? 'opacity-100' : 'opacity-70'}`}>{tool.label}</span>
                                </button>
                            );
                        })}
                        <div className="w-2 flex-shrink-0"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BillEditor;
