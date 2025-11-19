import React, { useState } from 'react';
import { X, Smartphone, CreditCard, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { generateBillPaymentQR, formatAmount } from '../../utils/upiQRGenerator';
import UPIIdInputModal from './UPIIdInputModal';

const UPIPaymentModal = ({ bill, onClose, onPaymentReceived, onSaveUPIId }) => {
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
      console.log('🔧 UPIPaymentModal - Bill object:', bill);
      console.log('🔧 UPIPaymentModal - Seller UPI ID from bill:', sellerUpiId);
      console.log('🔧 UPIPaymentModal - Seller UPI ID type:', typeof sellerUpiId);
      console.log('🔧 UPIPaymentModal - Seller UPI ID trimmed:', sellerUpiId?.trim());
      
      if (!sellerUpiId || !sellerUpiId.trim() || !sellerUpiId.includes('@')) {
        console.warn('⚠️ Seller UPI ID is missing or invalid, showing input modal');
        // Show UPI ID input modal instead of error
        setShowUPIIdInput(true);
        setIsGenerating(false);
        return;
      }
      
      const trimmedUpiId = sellerUpiId.trim();
      setIsGenerating(true);
      console.log('🔧 Generating QR code for bill:', bill);
      console.log('🔧 Using seller UPI ID (trimmed):', trimmedUpiId);
      
      // Explicitly use seller UPI ID for QR generation
      const result = await generateBillPaymentQR(bill, {
        upiId: trimmedUpiId, // Use seller's UPI ID explicitly
        merchantName: bill.storeName || 'Drag & Drop'
      });
      
      console.log('🔧 QR generation result:', result);
      console.log('🔧 QR code generated with UPI ID:', result.paymentSummary?.upiId);
      console.log('🔧 UPI URL contains:', result.upiUrl);
      
      // Verify UPI ID in the generated URL
      if (result.upiUrl && !result.upiUrl.includes(trimmedUpiId)) {
        console.error('❌ ERROR: Generated UPI URL does not contain seller UPI ID!');
        console.error('Expected UPI ID:', trimmedUpiId);
        console.error('UPI URL:', result.upiUrl);
      }
      
      setQrCodeDataURL(result.qrCodeDataURL);
      setPaymentSummary(result.paymentSummary);
      setUpiUrl(result.upiUrl);
      console.log('🔧 QR code data URL set:', result.qrCodeDataURL ? 'Success' : 'Failed');
    } catch (error) {
      console.error('❌ Error generating QR code:', error);
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
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Smartphone className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0 
                  ? 'Split Payment - Online Portion' 
                  : 'UPI Payment'}
              </h3>
              <p className="text-sm text-gray-500">
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
        <div className="p-6 space-y-6">
          {/* Bill Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Bill Summary</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Bill ID:</span>
                <span className="font-medium">#{bill.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Customer:</span>
                <span className="font-medium">{bill.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">UPI ID:</span>
                <span className="font-medium break-all">{bill.upiId}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-600">Date:</span>
                <span className="font-medium">{new Date(bill.date).toLocaleDateString()}</span>
              </div>
              
              {/* Split Payment Breakdown */}
              {bill.splitPaymentDetails && (
                <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                  <h5 className="font-medium text-indigo-900 mb-2">Split Payment Breakdown:</h5>
                  <div className="space-y-1 text-xs">
                    {bill.splitPaymentDetails.cashAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700">Cash:</span>
                        <span className="font-semibold text-indigo-900">{formatAmount(bill.splitPaymentDetails.cashAmount)}</span>
                      </div>
                    )}
                    {bill.splitPaymentDetails.onlineAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700">Online:</span>
                        <span className="font-semibold text-indigo-900">{formatAmount(bill.splitPaymentDetails.onlineAmount)}</span>
                      </div>
                    )}
                    {bill.splitPaymentDetails.dueAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-indigo-700">Due:</span>
                        <span className="font-semibold text-indigo-900">{formatAmount(bill.splitPaymentDetails.dueAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-indigo-200 pt-1 mt-1">
                      <span className="text-indigo-700 font-medium">Bill Total:</span>
                      <span className="font-semibold text-indigo-900">{formatAmount(bill.total)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Bill Items */}
              <div className="mt-3">
                <h5 className="font-medium text-gray-800 mb-2">Items:</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {bill.items.map((item, index) => (
                    <div key={index} className="flex justify-between text-xs">
                      <span className="text-gray-600">{item.name}</span>
                      <span className="font-medium">
                        {item.quantity} {item.unit} × ₹{(item.price || 0).toFixed(2)} = ₹{(item.total || (item.price || 0) * (item.quantity || 0)).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex justify-between text-lg font-semibold border-t pt-2 mt-3">
                <span className="text-gray-900">
                  {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0 
                    ? 'Online Payment Amount:' 
                    : 'Total Amount:'}
                </span>
                <span className="text-green-600">
                  {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                    ? formatAmount(bill.splitPaymentDetails.onlineAmount)
                    : formatAmount(bill.total)}
                </span>
              </div>
            </div>
          </div>

          {/* QR Code */}
          <div className="text-center">
            <h4 className="font-medium text-gray-900 mb-4">Scan to Pay</h4>
            {isGenerating ? (
              <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-2"></div>
                  <p className="text-sm text-gray-600">Generating QR Code...</p>
                </div>
              </div>
            ) : qrCodeDataURL ? (
              <div className="bg-white border-2 border-gray-200 rounded-lg p-4 inline-block">
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
              <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
                <div className="text-center">
                  <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Failed to generate QR code</p>
                </div>
              </div>
            )}
          </div>

          {/* Payment Instructions */}
          <div className="bg-blue-50 rounded-lg p-4">
            <h5 className="font-medium text-blue-900 mb-2">Payment Instructions:</h5>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Open your UPI app (Paytm, PhonePe, Google Pay)</li>
              <li>• Scan the QR code above</li>
              <li>• Verify the amount: <span className="font-semibold">
                {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0
                  ? formatAmount(bill.splitPaymentDetails.onlineAmount)
                  : formatAmount(bill.total)}
              </span></li>
              {bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0 && (
                <li className="text-indigo-700 font-medium">• This is a split payment - paying only the online portion</li>
              )}
              <li>• Complete the payment</li>
              <li>• Click "Payment Received" below to confirm</li>
            </ul>
          </div>

          {/* Alternative Payment Methods */}
          <div className="space-y-3">
            <h5 className="font-medium text-gray-900">Alternative Payment:</h5>
            <div className="flex space-x-2">
              <button
                onClick={handleCopyUPIUrl}
                className="flex-1 btn-secondary flex items-center justify-center text-sm"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Copy UPI Link
              </button>
              <button
                onClick={handleOpenUPIApp}
                className="flex-1 btn-primary flex items-center justify-center text-sm"
              >
                <Smartphone className="h-4 w-4 mr-2" />
                Open UPI App
              </button>
            </div>
          </div>

          {/* Payment Status */}
          <div className="text-center">
            {paymentStatus === 'pending' && (
              <div className="flex items-center justify-center space-x-2 text-orange-600">
                <Clock className="h-5 w-5" />
                <span className="font-medium">Waiting for Payment...</span>
              </div>
            )}
            {paymentStatus === 'completed' && (
              <div className="flex items-center justify-center space-x-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Payment Confirmed!</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 btn-secondary"
            disabled={paymentStatus === 'completed'}
          >
            {paymentStatus === 'completed' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handlePaymentReceived}
            className="flex-1 btn-primary flex items-center justify-center"
            disabled={paymentStatus === 'completed'}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
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
