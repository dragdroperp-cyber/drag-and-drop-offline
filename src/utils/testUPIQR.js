// Test UPI QR Generator
import { generateBillPaymentQR, createUPIPaymentURL } from './src/utils/upiQRGenerator';
// Test function to verify UPI QR generation
const testUPIQR = async () => {
  try {
    // Test UPI URL creation
    const testUrl = createUPIPaymentURL(523.50, 'TXN123', 'Test Store', 'Test Payment');
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
    return true;
  } catch (error) {
    return false;
  }
};
// Export for testing
window.testUPIQR = testUPIQR;
export default testUPIQR;