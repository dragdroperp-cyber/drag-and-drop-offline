import React, { useState, useEffect } from 'react';
import { ScanLine, X, Zap, CheckCircle, AlertCircle } from 'lucide-react';

const BarcodeMachine = ({ onScan, onClose }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState('');
  const [scanHistory, setScanHistory] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  // Simulate machine connection
  useEffect(() => {
    const connectMachine = () => {
      setConnectionStatus('connecting');
      setTimeout(() => {
        setIsConnected(true);
        setConnectionStatus('connected');
      }, 1500);
    };

    connectMachine();
  }, []);

  // Simulate barcode scanning
  const simulateScan = () => {
    if (!isConnected) return;

    setIsScanning(true);
    
    // Simulate scanning delay
    setTimeout(() => {
      // Generate a random barcode for demo purposes
      const randomBarcode = Math.random().toString(36).substring(2, 15).toUpperCase();
      setLastScannedCode(randomBarcode);
      
      // Add to scan history
      setScanHistory(prev => [
        { code: randomBarcode, timestamp: new Date(), success: true },
        ...prev.slice(0, 4) // Keep only last 5 scans
      ]);
      
      setIsScanning(false);
      
      // Auto-send the scanned code
      if (onScan) {
        onScan(randomBarcode);
      }
    }, 2000);
  };

  const disconnectMachine = () => {
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setLastScannedCode('');
    setScanHistory([]);
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-600';
      case 'connecting': return 'text-yellow-600';
      case 'disconnected': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <CheckCircle className="h-5 w-5" />;
      case 'connecting': return <Zap className="h-5 w-5 animate-pulse" />;
      case 'disconnected': return <AlertCircle className="h-5 w-5" />;
      default: return <AlertCircle className="h-5 w-5" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg mr-3">
              <ScanLine className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Barcode Machine</h2>
              <p className="text-sm text-gray-600">Physical Scanner Interface</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Connection Status */}
        <div className="mb-6">
          <div className={`flex items-center space-x-2 p-3 rounded-lg ${
            connectionStatus === 'connected' ? 'bg-green-50 border border-green-200' :
            connectionStatus === 'connecting' ? 'bg-yellow-50 border border-yellow-200' :
            'bg-red-50 border border-red-200'
          }`}>
            {getStatusIcon()}
            <span className={`font-medium ${getStatusColor()}`}>
              {connectionStatus === 'connected' ? 'Machine Connected' :
               connectionStatus === 'connecting' ? 'Connecting...' :
               'Machine Disconnected'}
            </span>
          </div>
        </div>

        {/* Machine Interface */}
        <div className="space-y-4">
          {/* Scan Button */}
          <button
            onClick={simulateScan}
            disabled={!isConnected || isScanning}
            className={`w-full py-4 px-6 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center ${
              isConnected && !isScanning
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isScanning ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Scanning...
              </>
            ) : (
              <>
                <ScanLine className="h-5 w-5 mr-2" />
                {isConnected ? 'Scan Barcode' : 'Connect Machine First'}
              </>
            )}
          </button>

          {/* Last Scanned Code */}
          {lastScannedCode && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="font-medium text-green-800">Last Scanned:</span>
              </div>
              <p className="font-mono text-lg text-green-900">{lastScannedCode}</p>
            </div>
          )}

          {/* Scan History */}
          {scanHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Recent Scans:</h3>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {scanHistory.map((scan, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span className="font-mono text-sm">{scan.code}</span>
                    <span className="text-xs text-gray-500">
                      {scan.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-800 mb-2">Instructions:</h3>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• Ensure your barcode scanner machine is connected</li>
              <li>• Click "Scan Barcode" to simulate scanning</li>
              <li>• The scanned code will be automatically processed</li>
              <li>• Use physical scanner for real barcode scanning</li>
            </ul>
          </div>

          {/* Disconnect Button */}
          {isConnected && (
            <button
              onClick={disconnectMachine}
              className="w-full py-2 px-4 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
            >
              Disconnect Machine
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BarcodeMachine;

