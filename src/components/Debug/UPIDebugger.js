import React, { useState } from 'react';
import { generateBillPaymentQR, createUPIPaymentURL } from '../../utils/upiQRGenerator';

const UPIDebugger = () => {
  const [testResult, setTestResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const testUPIQR = async () => {
    setIsLoading(true);
    try {
      console.log('🧪 Testing UPI QR Generator...');
      
      // Test UPI URL creation
      const testUrl = createUPIPaymentURL(523.50, 'TXN123', 'Test Store', 'Test Payment');
      console.log('✅ UPI URL created:', testUrl);
      
      // Test bill payment QR generation
      const testBill = {
        id: 'TEST123',
        customerName: 'Test Customer',
        total: 523.50,
        items: [
          { name: 'Test Item', quantity: 2, price: 261.75 }
        ]
      };
      
      const result = await generateBillPaymentQR(testBill);
      console.log('✅ QR Code generated:', result.qrCodeDataURL ? 'Success' : 'Failed');
      console.log('✅ Payment Summary:', result.paymentSummary);
      console.log('✅ UPI URL:', result.upiUrl);
      
      setTestResult({
        success: true,
        upiUrl: testUrl,
        qrCode: result.qrCodeDataURL,
        paymentSummary: result.paymentSummary
      });
      
    } catch (error) {
      console.error('❌ UPI QR Test failed:', error);
      setTestResult({
        success: false,
        error: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h3 className="text-lg font-semibold mb-4">UPI QR Code Debugger</h3>
      
      <button
        onClick={testUPIQR}
        disabled={isLoading}
        className="btn-primary mb-4"
      >
        {isLoading ? 'Testing...' : 'Test UPI QR Generation'}
      </button>
      
      {testResult && (
        <div className="space-y-4">
          {testResult.success ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-medium text-green-800">✅ Test Successful!</h4>
                <p className="text-sm text-green-700">UPI QR code generated successfully</p>
              </div>
              
              <div className="space-y-2">
                <div>
                  <label className="text-sm font-medium text-gray-700">UPI URL:</label>
                  <p className="text-xs bg-gray-100 p-2 rounded break-all">{testResult.upiUrl}</p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-gray-700">QR Code:</label>
                  {testResult.qrCode && (
                    <div className="mt-2">
                      <img 
                        src={testResult.qrCode} 
                        alt="Test QR Code" 
                        className="w-32 h-32 border border-gray-300"
                      />
                    </div>
                  )}
                </div>
                
                <div>
                  <label className="text-sm font-medium text-gray-700">Payment Summary:</label>
                  <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto">
                    {JSON.stringify(testResult.paymentSummary, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-medium text-red-800">❌ Test Failed</h4>
              <p className="text-sm text-red-700">Error: {testResult.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UPIDebugger;

