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

  React.useEffect(() => {
    generateQRCode();
  }, [bill]);

  const generateQRCode = async () => {
    try {
      // Ensure seller UPI ID is present
      const sellerUpiId = bill?.upiId;

      //('🔧 UPIPaymentModal - Seller UPI ID trimmed:', sellerUpiId?.trim());

      if (!sellerUpiId || !sellerUpiId.trim() || !sellerUpiId.includes('@')) {

        // Show UPI ID input modal instead of error
        setShowUPIIdInput(true);
        setIsGenerating(false);
        return;
      }

      const trimmedUpiId = sellerUpiId.trim();
      setIsGenerating(true);

      //('🔧 Using seller UPI ID (trimmed):', trimmedUpiId);

      // Explicitly use seller UPI ID for QR generation
      const result = await generateBillPaymentQR(bill, {
        upiId: trimmedUpiId, // Use seller's UPI ID explicitly
        merchantName: bill.storeName || 'Drag & Drop'
      });

      // Verify UPI ID in the generated URL
      if (result.upiUrl && !result.upiUrl.includes(trimmedUpiId)) {

      }

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
      // Update bill prop will be handled by parent component
      // Trigger QR code regeneration with updated bill
      setIsGenerating(true);
      // Wait a bit for state to update
      setTimeout(() => {
        generateQRCode();
      }, 200);
    }
  };

  const handleCancelUPIIdInput = () => {
    setShowUPIIdInput(false);
    onClose(); // Close the payment modal if UPI ID is not provided
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
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white dark:bg-slate-900 w-full h-[95%] sm:h-auto sm:max-w-md rounded-none sm:rounded-2xl shadow-2xl border dark:border-slate-700/60 flex flex-col overflow-hidden transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700/60">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <Smartphone className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                  ? 'Split Payment - Online Portion'
                  : 'UPI Payment'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                  ? `Pay ₹${(bill.splitPaymentDetails.onlineAmount || 0).toFixed(2)} online`
                  : 'Scan QR code to pay'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          {/* Bill Summary */}
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-700/50">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-gray-400" />
              Bill Summary
            </h4>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Bill ID:</span>
                <span className="font-medium text-gray-900 dark:text-white">#{bill.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Customer:</span>
                <span className="font-medium text-gray-900 dark:text-white">{bill.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">UPI ID:</span>
                <span className="font-medium text-gray-900 dark:text-white break-all text-right max-w-[200px]">{bill.upiId}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Date:</span>
                <span className="font-medium text-gray-900 dark:text-white">{formatDate(bill.date)}</span>
              </div>

              {/* Split Payment Breakdown */}
              {bill.splitPaymentDetails && (
                <div className="mt-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-xl">
                  <h5 className="font-semibold text-indigo-900 dark:text-indigo-300 text-xs uppercase tracking-wider mb-2">Split Payment Breakdown</h5>
                  <div className="space-y-1.5 text-sm">
                    {bill.splitPaymentDetails.cashAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700 dark:text-indigo-400/80">Cash:</span>
                        <span className="font-bold text-indigo-900 dark:text-indigo-200">{formatAmount(bill.splitPaymentDetails.cashAmount)}</span>
                      </div>
                    )}
                    {bill.splitPaymentDetails.onlineAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700 dark:text-indigo-400/80">Online:</span>
                        <span className="font-bold text-indigo-900 dark:text-indigo-200">{formatAmount(bill.splitPaymentDetails.onlineAmount)}</span>
                      </div>
                    )}
                    {bill.splitPaymentDetails.dueAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700 dark:text-indigo-400/80">Due:</span>
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

              {/* Bill Items */}
              <div className="mt-4">
                <h5 className="font-semibold text-gray-800 dark:text-slate-300 mb-2 truncate">Items</h5>
                <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                  {bill.items.map((item, index) => (
                    <div key={index} className="flex justify-between text-xs">
                      <span className="text-gray-600 dark:text-slate-400 truncate max-w-[150px]">{item.name}</span>
                      <span className="font-medium text-gray-900 dark:text-slate-200">
                        {item.quantity} {item.unit} × ₹{(item.price || 0).toFixed(2)} = ₹{(item.total || (item.price || 0) * (item.quantity || 0)).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between text-lg font-bold border-t border-gray-200 dark:border-slate-700/60 pt-3 mt-4">
                <span className="text-gray-900 dark:text-white">
                  {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                    ? 'Online Amount:'
                    : 'Grand Total:'}
                </span>
                <span className="text-green-600 dark:text-green-400">
                  {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                    ? formatAmount(bill.splitPaymentDetails.onlineAmount)
                    : formatAmount(bill.total)}
                </span>
              </div>
            </div>
          </div>

          {/* QR Code */}
          <div className="text-center">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-4">Scan to Pay</h4>
            {isGenerating ? (
              <div className="flex items-center justify-center h-64 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-gray-200 dark:border-slate-700">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-3"></div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 font-medium">Generating QR Code...</p>
                </div>
              </div>
            ) : qrCodeDataURL ? (
              <div className="bg-white dark:bg-slate-200 border-2 border-gray-100 dark:border-slate-400 rounded-2xl p-5 inline-block shadow-lg">
                <img
                  src={qrCodeDataURL}
                  alt="UPI Payment QR Code"
                  className="w-64 h-64 mx-auto"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Scan with any UPI app (Paytm, PhonePe, Google Pay, etc.)
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 bg-red-50 dark:bg-red-900/10 rounded-xl border border-dashed border-red-200 dark:border-red-900/30">
                <div className="text-center">
                  <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
                  <p className="text-sm text-red-700 dark:text-red-400 font-medium">Failed to generate QR code</p>
                </div>
              </div>
            )}
          </div>

          {/* Payment Instructions */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800/30">
            <h5 className="font-semibold text-blue-900 dark:text-blue-300 mb-3 flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              How to Pay?
            </h5>
            <ul className="text-sm text-blue-800 dark:text-blue-400/90 space-y-2">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-200 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                <span>Open your UPI app (Paytm, Google Pay, etc.)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-200 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                <span>Scan the QR code above or use the link below</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-200 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                <span>Verify the amount: <span className="font-bold text-blue-950 dark:text-white">
                  {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                    ? formatAmount(bill.splitPaymentDetails.onlineAmount)
                    : formatAmount(bill.total)}
                </span></span>
              </li>
              {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0 && (
                <li className="flex items-start gap-2 text-indigo-700 dark:text-indigo-300 font-medium">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 flex-shrink-0"></div>
                  <span>Paying only the online portion of a split payment</span>
                </li>
              )}
              <li className="flex items-start gap-2 font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0"></div>
                <span>Complete the payment and click "Payment Received" below</span>
              </li>
            </ul>
          </div>



          {/* Payment Status */}
          <div className="text-center pt-2">

            {paymentStatus === 'completed' && (
              <div className="flex items-center justify-center space-x-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10 py-2 rounded-lg border border-green-100 dark:border-green-900/20">
                <CheckCircle className="h-5 w-5" />
                <span className="font-bold text-sm">Payment Confirmed!</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-slate-700/60 bg-gray-50/50 dark:bg-slate-800/20">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 transition-all active:scale-[0.98]"
            disabled={paymentStatus === 'completed'}
          >
            {paymentStatus === 'completed' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handlePaymentReceived}
            className="flex-1 px-4 py-3 rounded-xl bg-green-600 dark:bg-green-500 text-white font-semibold shadow-lg shadow-green-500/20 hover:bg-green-700 dark:hover:bg-green-600 transition-all flex items-center justify-center active:scale-[0.98]"
            disabled={paymentStatus === 'completed'}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Received
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
