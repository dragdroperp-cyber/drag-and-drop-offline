import React, { useEffect } from 'react';
import { Gavel, ScrollText, AlertCircle, HelpCircle, ArrowLeft, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const TermsAndConditions = () => {
    const navigate = useNavigate();

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const sections = [
        {
            title: "1. Acceptance of Terms",
            icon: <ScrollText className="text-blue-600" size={24} />,
            content: "By accessing or using Inventory Studio, you agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, you may not use our services."
        },
        {
            title: "2. User Responsibilities",
            icon: <HelpCircle className="text-emerald-600" size={24} />,
            content: "Users are responsible for maintaining the confidentiality of their account credentials and for all activities that occur under their account. You agree to provide accurate business information."
        },
        {
            title: "3. Service Limitations & Data Consistency",
            icon: <AlertCircle className="text-amber-600" size={24} />,
            content: "Inventory Studio provides offline-first functionality. While we strive for 100% data integrity, you acknowledge that using the application on multiple devices in offline mode simultaneously may lead to data inconsistencies, duplicate entries, or conflicts. We strongly recommend syncing all devices to the internet regularly to ensure a unified state. Local data is temporary and must be synced to the cloud for permanent backup."
        },
        {
            title: "4. Indian Law Compliance",
            icon: <Shield className="text-blue-600" size={24} />,
            content: "These terms are governed by the Information Technology Act, 2000 and the Digital Personal Data Protection Act (DPDP), 2023 of India. Users are required to comply with all applicable local, state, and national laws while using Inventory Studio for their business operations."
        },
        {
            title: "5. Intellectual Property",
            icon: <Gavel className="text-indigo-600" size={24} />,
            content: "All content, features, and functionality of Inventory Studio are the exclusive property of our company. You may not reproduce, distribute, or create derivative works without permission."
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
                    <h1 className="text-4xl sm:text-5xl font-black mb-4 tracking-tight">Terms & Conditions</h1>
                    <p className="text-slate-500 font-medium text-lg">Last updated: February 2026</p>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-100 border border-slate-100 p-8 sm:p-12">
                    <p className="text-slate-600 leading-relaxed mb-12 text-lg">
                        Please read these Terms and Conditions carefully before using the Inventory Studio ERP application.
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
                        <h3 className="text-xl font-bold mb-4">Governing Law</h3>
                        <p className="text-slate-600 leading-relaxed">
                            These terms shall be governed by and construed in accordance with the laws of India. Any disputes arising from these terms shall be subject to the exclusive jurisdiction of the courts in India.
                        </p>
                    </div>

                    <div className="mt-8 pt-8 border-t border-slate-50">
                        <h3 className="text-xl font-bold mb-4">Contact Information</h3>
                        <p className="text-slate-600 leading-relaxed">
                            For any inquiries regarding these Terms and Conditions, please contact us at <span className="text-blue-600 font-bold">draganddrop.in@gmail.com</span>.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TermsAndConditions;
