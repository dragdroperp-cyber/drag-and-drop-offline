import React, { useState } from 'react';
import { X, Smartphone, CreditCard, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { generateBillPaymentQR, formatAmount } from '../../utils/upiQRGenerator';
import UPIIdInputModal from './UPIIdInputModal';
import { formatDate } from '../../utils/dateUtils';

const UPIPaymentModal = ({ bill, onClose, onPaymentReceived, onSaveUPIId }) => {
  const { state } = useApp();
  const [paymentStatus, setPaymentStatus] = useState('pending'); // pending, completed, failed
  const [qrCodeDataURL, setQrCodeDataURL] = useState(null);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [upiUrl, setUpiUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(true);
  const [showUPIIdInput, setShowUPIIdInput] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  React.useEffect(() => {
    generateQRCode();
  }, [bill]);

  const generateQRCode = async () => {
    try {
      // Ensure seller UPI ID is present
      const sellerUpiId = bill?.upiId;

      if (!sellerUpiId || !sellerUpiId.trim() || !sellerUpiId.includes('@')) {
        setShowUPIIdInput(true);
        setIsGenerating(false);
        return;
      }

      const trimmedUpiId = sellerUpiId.trim();
      setIsGenerating(true);

      const result = await generateBillPaymentQR(bill, {
        upiId: trimmedUpiId,
        merchantName: bill.storeName || 'Drag & Drop'
      });

      setQrCodeDataURL(result.qrCodeDataURL);
      setPaymentSummary(result.paymentSummary);
      setUpiUrl(result.upiUrl);

    } catch (error) {
      window.showToast(error.message || 'Error generating QR code', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveUPIId = async (upiId) => {
    if (onSaveUPIId) {
      await onSaveUPIId(upiId);
      setShowUPIIdInput(false);
      setIsGenerating(true);
      setTimeout(() => {
        generateQRCode();
      }, 200);
    }
  };

  const handleCancelUPIIdInput = () => {
    setShowUPIIdInput(false);
    handleCloseModal();
  };

  const handlePaymentReceived = () => {
    setPaymentStatus('completed');
    onPaymentReceived(paymentSummary);
    window.showToast('Payment confirmed successfully!', 'success');
  };

  const handleCopyUPIUrl = () => {
    navigator.clipboard.writeText(upiUrl);
    window.showToast('UPI URL copied to clipboard', 'success');
  };

  const handleOpenUPIApp = () => {
    window.open(upiUrl, '_blank');
  };

  return (
    <div
      className={`fixed inset-0 bg-slate-900/40 flex items-end md:items-center justify-center z-[1300] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
    >
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
      <div
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
        className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-md border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:max-h-[90vh] m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
              {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                ? 'Split Payment'
                : 'UPI Payment'}
            </h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
              {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                ? `Pay Online: ₹${(bill.splitPaymentDetails.onlineAmount || 0).toFixed(2)}`
                : 'Scan QR code to pay'}
            </p>
          </div>
          <button
            onClick={handleCloseModal}
            className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* Bill Summary */}
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-700/50">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Smartphone className="h-3 w-3" />
              Bill Summary
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-slate-400 font-medium lowercase">bill id:</span>
                <span className="font-bold text-gray-900 dark:text-white">#{bill.id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-slate-400 font-medium lowercase">customer:</span>
                <span className="font-bold text-gray-900 dark:text-white truncate max-w-[150px]">{bill.customerName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 dark:text-slate-400 font-medium lowercase">upi id:</span>
                <span className="font-bold text-gray-900 dark:text-white break-all text-right max-w-[180px]">{bill.upiId}</span>
              </div>

              {/* Split Payment Breakdown */}
              {bill.splitPaymentDetails && (
                <div className="mt-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-lg">
                  <h5 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">Split Breakdown</h5>
                  <div className="space-y-1.5 text-xs">
                    {bill.splitPaymentDetails.cashAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700 dark:text-slate-100/80 font-medium">Cash:</span>
                        <span className="font-bold text-indigo-900 dark:text-indigo-200">{formatAmount(bill.splitPaymentDetails.cashAmount)}</span>
                      </div>
                    )}
                    {bill.splitPaymentDetails.onlineAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700 dark:text-slate-100/80 font-medium">Online:</span>
                        <span className="font-bold text-indigo-900 dark:text-indigo-200">{formatAmount(bill.splitPaymentDetails.onlineAmount)}</span>
                      </div>
                    )}
                    {bill.splitPaymentDetails.dueAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700 dark:text-slate-100/80 font-medium">Due:</span>
                        <span className="font-bold text-indigo-900 dark:text-indigo-200">{formatAmount(bill.splitPaymentDetails.dueAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-indigo-200 dark:border-indigo-800/50 pt-2 mt-2">
                      <span className="text-indigo-700 dark:text-indigo-300 font-bold">Total Bill:</span>
                      <span className="font-bold text-indigo-900 dark:text-indigo-100">{formatAmount(bill.total)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center text-lg font-bold border-t border-gray-100 dark:border-slate-800 pt-3 mt-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                    ? 'Pay Online'
                    : 'Grand Total'}
                </span>
                <span className="text-green-600 dark:text-green-400 text-xl font-bold">
                  {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                    ? formatAmount(bill.splitPaymentDetails.onlineAmount)
                    : formatAmount(bill.total)}
                </span>
              </div>
            </div>
          </div>

          {/* QR Code */}
          <div className="text-center py-4">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Scan QR to Pay</h4>
            {isGenerating ? (
              <div className="flex items-center justify-center h-64 bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-3"></div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Generating...</p>
                </div>
              </div>
            ) : qrCodeDataURL ? (
              <div className="bg-white p-4 rounded-xl shadow-lg border border-gray-100 dark:border-slate-800 inline-block">
                <img
                  src={qrCodeDataURL}
                  alt="UPI Payment QR Code"
                  className="w-56 h-56 mx-auto"
                />
                <p className="text-[10px] text-gray-400 font-bold mt-3 uppercase tracking-widest">
                  Supports Google Pay, PhonePe, Paytm & More
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30">
                <div className="text-center p-6">
                  <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                  <p className="text-[10px] text-red-700 dark:text-red-400 font-bold uppercase tracking-widest">QR Generation Failed</p>
                </div>
              </div>
            )}
          </div>

          {/* Payment Status (Only when completed) */}
          {paymentStatus === 'completed' && (
            <div className="flex items-center justify-center space-x-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10 py-3 rounded-lg border border-green-100 dark:border-green-900/20 animate-fadeIn">
              <CheckCircle className="h-5 w-5" />
              <span className="font-bold text-sm uppercase tracking-widest">Payment Confirmed</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 pt-0 pb-8 md:pb-6 flex gap-3">
          <button
            onClick={handleCloseModal}
            className="flex-1 py-3.5 px-4 bg-gray-100 dark:bg-slate-800 rounded-lg text-sm font-bold text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all active:scale-[0.98]"
          >
            {paymentStatus === 'completed' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handlePaymentReceived}
            disabled={paymentStatus === 'completed'}
            className="flex-[2] py-3.5 px-4 bg-gray-900 dark:bg-slate-900 rounded-lg text-sm font-bold text-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <CheckCircle className="h-4 w-4" />
            Payment Received
          </button>
        </div>
      </div>

      {/* UPI ID Input Modal */}
      {showUPIIdInput && (
        <UPIIdInputModal
          onSave={handleSaveUPIId}
          onCancel={handleCancelUPIIdInput}
        />
      )}
    </div>
  );
};

export default UPIPaymentModal;
