import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, RefreshCw } from 'lucide-react';

const BarcodeScanner = ({ onScan, onClose }) => {
  const scannerRef = useRef(null);
  const qrReaderRef = useRef(null);
  const containerIdRef = useRef(`qr-reader-${Math.random().toString(36).slice(2, 10)}`);
  const [error, setError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [activeCameraIndex, setActiveCameraIndex] = useState(0);
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const isRunningRef = useRef(false);
  const scanProcessedRef = useRef(false);
  const audioContextRef = useRef(null);

  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  }, [onScan, onClose]);

  const playBeep = () => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);
    } catch (err) {
      console.log('Beep playback error:', err);
    }
  };

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      const state = scanner.getState?.();
      if (state === 2) {
        await scanner.stop();
      }
    } catch (err) {
      console.log('Scanner stop error:', err);
    }
    try {
      const mediaStream = scanner._localMediaStream;
      if (mediaStream && typeof mediaStream.getTracks === 'function') {
        mediaStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (trackErr) {
            console.log('Track stop error:', trackErr);
          }
        });
      }
    } catch (streamErr) {
      console.log('Stream cleanup error:', streamErr);
    }
    try {
      await scanner.clear();
    } catch (err) {
      console.log('Scanner clear error:', err);
    }
    scannerRef.current = null;
    isRunningRef.current = false;
  };

  const startScanner = async (cameraId) => {
    setError('');
    const scannerElement = qrReaderRef.current;
    if (!scannerElement || !scannerElement.isConnected) {
      console.error('Scanner container not ready');
      setError('Camera preview is not ready. Please close and reopen the scanner.');
      return;
    }
    scanProcessedRef.current = false;

    await stopScanner();

    const html5QrCode = new Html5Qrcode(containerIdRef.current);
    scannerRef.current = html5QrCode;

    const config = {
      fps: 10,
      qrbox: { width: 320, height: 150 },
      aspectRatio: 2.0,
      supportedScanTypes: [Html5Qrcode.SCAN_TYPE_CAMERA],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
      disableFlip: false,
      showTorchButtonIfSupported: false,
      showZoomSliderIfSupported: false,
      tryHarder: true,
    };

    const cameraConfig = cameraId
      ? { deviceId: { exact: cameraId } }
      : { facingMode: 'environment' };

    const handleScanSuccess = (decodedText, decodedResult) => {
      if (scanProcessedRef.current) {
        return;
      }
      if (decodedText && decodedText.trim()) {
        scanProcessedRef.current = true;
        playBeep();
        onScanRef.current(decodedText.trim());
        stopScanner().finally(() => {
          setTimeout(() => onCloseRef.current(), 500);
        });
      }
    };

    const handleScanFailure = (errorMessage) => {
      if (
        errorMessage.includes('NotFound') ||
        errorMessage.includes('parse error') ||
        errorMessage.includes('No MultiFormat Readers') ||
        errorMessage.includes('continuous scanning')
      ) {
        return;
      }
      console.log('Scanning error:', errorMessage);
    };

    try {
      await html5QrCode.start(cameraConfig, config, handleScanSuccess, handleScanFailure);
      isRunningRef.current = true;
    } catch (err) {
      console.error('Scanner startup error:', err);
      try {
        await html5QrCode.clear().catch(() => {});
        const fallbackScanner = new Html5Qrcode(containerIdRef.current);
        scannerRef.current = fallbackScanner;
        await fallbackScanner.start(
          cameraConfig,
          { fps: 10, qrbox: { width: 320, height: 150 } },
          handleScanSuccess,
          () => {}
        );
        isRunningRef.current = true;
      } catch (fallbackErr) {
        console.error('Fallback scanner failed:', fallbackErr);
        let errorMsg = 'Camera not available. ';
        if (fallbackErr?.message?.includes('Permission')) {
          errorMsg += 'Please allow camera access in your browser settings.';
        } else if (fallbackErr?.message?.includes('NotFound')) {
          errorMsg += 'No camera found. Check if a camera is connected and free.';
        } else if (fallbackErr?.message?.includes('NotAllowed')) {
          errorMsg += 'Camera access denied. Grant permission and refresh the page.';
        } else {
          errorMsg += fallbackErr?.message || 'Unknown error';
        }
        setError(errorMsg);
        isRunningRef.current = false;
        await stopScanner();
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const setupScanner = async () => {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (!isMounted) return;
        setCameras(devices || []);
        if (devices && devices.length > 0) {
          setActiveCameraIndex(0);
          await startScanner(devices[0].id);
        } else {
          await startScanner();
        }
      } catch (err) {
        console.log('Unable to enumerate cameras:', err);
        await startScanner();
      }
    };

    setupScanner();

    return () => {
      isMounted = false;
      stopScanner();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const handleSwitchCamera = async () => {
    if (cameras.length < 2 || isSwitchingCamera) return;
    const nextIndex = (activeCameraIndex + 1) % cameras.length;
    setIsSwitchingCamera(true);
    try {
      await startScanner(cameras[nextIndex].id);
      setActiveCameraIndex(nextIndex);
    } catch (err) {
      console.error('Camera switch failed:', err);
    } finally {
      setIsSwitchingCamera(false);
    }
  };

  const handleClose = async () => {
    await stopScanner();
    onCloseRef.current();
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl z-10">
          <h2 className="text-lg sm:text-2xl font-bold text-gray-800">Barcode Scanner</h2>
          <div className="flex items-center gap-2">
            {cameras.length > 1 && (
              <button
                onClick={handleSwitchCamera}
                disabled={isSwitchingCamera}
                className="p-2 text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 transition disabled:opacity-50"
                title="Switch camera"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
              aria-label="Close scanner"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center space-y-4 p-4 sm:p-6">
          {error ? (
            <div className="text-red-600 text-center p-4">
              <p className="text-sm sm:text-base font-medium">{error}</p>
              <div className="text-xs sm:text-sm mt-3 space-y-2 text-left bg-red-50 p-3 rounded-lg">
                <p className="font-medium mb-2">Troubleshooting steps:</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Check if camera permission is granted in browser settings</li>
                  <li>Close other apps that might be using the camera</li>
                  <li>Try refreshing the page</li>
                  <li>Use a supported browser (Chrome, Firefox, Edge)</li>
                  <li>Ensure you're on HTTPS or localhost</li>
                </ul>
              </div>
            </div>
          ) : (
            <>
              <div className="relative w-full mx-auto overflow-hidden rounded-lg" style={{ maxWidth: '100%', minHeight: '220px' }}>
                <div
                  id={containerIdRef.current}
                  ref={qrReaderRef}
                  className="w-full h-full bg-gray-100"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;
