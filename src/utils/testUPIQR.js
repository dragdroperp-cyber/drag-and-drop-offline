// Test UPI QR Generator
import { generateBillPaymentQR, createUPIPaymentURL } from './src/utils/upiQRGenerator';

// Test function to verify UPI QR generation
const testUPIQR = async () => {
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
    
    return true;
  } catch (error) {
    console.error('❌ UPI QR Test failed:', error);
    return false;
  }
};

// Export for testing
window.testUPIQR = testUPIQR;

export default testUPIQR;

