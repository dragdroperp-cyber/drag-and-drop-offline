import React, { useEffect } from 'react';
import { Shield, FileText, Lock, Eye, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PrivacyPolicy = () => {
    const navigate = useNavigate();

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const sections = [
        {
            title: "1. Information We Collect",
            icon: <FileText className="text-blue-600" size={24} />,
            content: "We collect information you provide directly to us when you create an account, complete your business profile, or use our services. This includes business name, GSTIN, UPI ID, contact details, and inventory data."
        },
        {
            title: "2. How We Use Information",
            icon: <Eye className="text-emerald-600" size={24} />,
            content: "We use the collected information to provide, maintain, and improve our services, process transactions, generate invoices, and communicate with you about your account and updates."
        },
        {
            title: "3. Data Protection & Indian Laws",
            icon: <Shield className="text-amber-600" size={24} />,
            content: "Inventory Studio complies with the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011 (SPDI Rules) and the Digital Personal Data Protection Act (DPDP), 2023. We ensure that your sensitive business data is processed with explicit consent and stored within secure cloud instances."
        },
        {
            title: "4. Data Residency & Offline Sync",
            icon: <Lock className="text-indigo-600" size={24} />,
            content: "For optimal performance, some data is stored locally in your browser/device (IndexedDB). While this enables offline work, users should be aware that data not yet synced to our servers is at risk if the local cache is cleared or the device is lost. We provide transparent sync indicators to help you manage this 'sync-window' risk."
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
            <div className="bg-white border-b border-slate-200 sticky top-0 z-50">
                <div className="max-w-4xl mx-auto px-6 h-20 flex items-center justify-between">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors font-bold text-sm"
                    >
                        <ArrowLeft size={18} />
                        Back
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 flex items-center justify-center overflow-hidden">
                            <img src="/assets/inventory-studio-logo-removebg.png" alt="IS" className="h-full w-full object-contain" />
                        </div>
                        <span className="text-sm font-black tracking-tight">Inventory Studio</span>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 pt-16">
                <div className="text-center mb-16">
                    <h1 className="text-4xl sm:text-5xl font-black mb-4 tracking-tight">Privacy Policy</h1>
                    <p className="text-slate-500 font-medium text-lg">Last updated: February 2026</p>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-100 border border-slate-100 p-8 sm:p-12">
                    <p className="text-slate-600 leading-relaxed mb-12 text-lg">
                        At Inventory Studio, we take your privacy seriously. This Privacy Policy explains how we collect, use, and protect your information when you use our ERP software.
                    </p>

                    <div className="space-y-12">
                        {sections.map((section, index) => (
                            <div key={index} className="relative pl-16">
                                <div className="absolute left-0 top-0 h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center">
                                    {section.icon}
                                </div>
                                <h3 className="text-xl font-bold mb-3">{section.title}</h3>
                                <p className="text-slate-600 leading-relaxed">
                                    {section.content}
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-16 pt-12 border-t border-slate-100">
                        <h3 className="text-xl font-bold mb-4">Contact Us</h3>
                        <p className="text-slate-600 leading-relaxed">
                            If you have any questions about this Privacy Policy, please contact us at <span className="text-blue-600 font-bold">draganddrop.in@gmail.com</span>.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPolicy;
