import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, RefreshCw, Zap, ZapOff, Camera } from 'lucide-react';

const BarcodeScanner = React.forwardRef(({ onScan, onClose, inline = false, keepOpen = false, containerWidth, containerHeight, enableTorch = true, hideControls = false, className = '' }, ref) => {
  const scannerRef = useRef(null);
  const qrReaderRef = useRef(null);
  const containerIdRef = useRef(`qr-reader-${Math.random().toString(36).slice(2, 10)}`);
  const [error, setError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [activeCameraIndex, setActiveCameraIndex] = useState(0);
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const isRunningRef = useRef(false);
  const scanProcessedRef = useRef(false);
  const audioContextRef = useRef(null);
  const lastContainerSizeRef = useRef({ width: 0, height: 0 });

  React.useImperativeHandle(ref, () => ({
    switchCamera: handleSwitchCamera,
    toggleTorch: toggleTorch,
    stop: stopScanner,
    start: () => startScanner(cameras[activeCameraIndex]?.id)
  }));

  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  }, [onScan, onClose]);

  // Restart camera when container size changes significantly
  useEffect(() => {
    if (!inline || !containerWidth || !containerHeight) return;

    const sizeChanged = Math.abs(containerWidth - lastContainerSizeRef.current.width) > 50 ||
      Math.abs(containerHeight - lastContainerSizeRef.current.height) > 50;

    if (sizeChanged && isRunningRef.current) {

      // Stop current camera
      stopScanner().then(() => {
        // Start with new size after a brief delay
        setTimeout(() => {
          if (cameras.length > 0) {
            startScanner(cameras[activeCameraIndex].id);
          } else {
            startScanner();
          }
        }, 200);
      });
    }

    lastContainerSizeRef.current = { width: containerWidth, height: containerHeight };
  }, [containerWidth, containerHeight, inline]);

  const playBeep = () => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { });
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

    }
    try {
      const mediaStream = scanner._localMediaStream;
      if (mediaStream && typeof mediaStream.getTracks === 'function') {
        mediaStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (trackErr) {

          }
        });
      }
    } catch (streamErr) {

    }
    try {
      await scanner.clear();
    } catch (err) {

    }
    scannerRef.current = null;
    isRunningRef.current = false;
  };

  const checkTorchSupport = (attempts = 0) => {
    try {
      if (scannerRef.current) {
        const track = scannerRef.current.getRunningTrack();
        if (track) {
          const capabilities = track.getCapabilities();
          if (capabilities && capabilities.torch !== undefined) {
            setIsTorchSupported(true);
            return;
          }
        }
      }
    } catch (e) {
      console.warn("Torch detection failed:", e);
    }

    // Retry up to 5 times if track isn't ready
    if (attempts < 5) {
      setTimeout(() => checkTorchSupport(attempts + 1), 800);
    } else {
      // If still not detected, we'll try one last time after a longer delay
      // Some devices take time to expose capabilities
      setTimeout(() => {
        try {
          const track = scannerRef.current?.getRunningTrack();
          if (track?.getCapabilities()?.torch !== undefined) {
            setIsTorchSupported(true);
          }
        } catch (e) { }
      }, 3000);
    }
  };

  const startScanner = async (cameraId) => {
    setError('');
    const scannerElement = qrReaderRef.current;
    if (!scannerElement || !scannerElement.isConnected) {

      setError('Camera preview is not ready. Please close and reopen the scanner.');
      return;
    }
    scanProcessedRef.current = false;

    await stopScanner();

    const html5QrCode = new Html5Qrcode(containerIdRef.current);
    scannerRef.current = html5QrCode;

    // config for full-frame scanning
    // We do NOT define qrbox or aspectRatio to allow the scanner to use the 
    // full native resolution and field of view of the camera.
    // This solves the 'small frame' issue by scanning the entire video feed.

    const config = {
      fps: 15,
      supportedScanTypes: [Html5Qrcode.SCAN_TYPE_CAMERA],
      useBarCodeDetectorIfSupported: true, // Critical for "any angle" support
      verbose: false,
      disableFlip: false,
      showTorchButtonIfSupported: true, // Enable torch for better lighting
      showZoomSliderIfSupported: true, // Enable zoom for distant codes
      tryHarder: true, // Critical for robust detection
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.AZTEC,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.MAXICODE,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.PDF_417,
        Html5QrcodeSupportedFormats.RSS_14,
        Html5QrcodeSupportedFormats.RSS_EXPANDED,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION
      ]
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

        // Only auto-close if keepOpen is false
        if (!keepOpen) {
          stopScanner().finally(() => {
            setTimeout(() => onCloseRef.current(), 500);
          });
        } else {
          // Reset scanProcessedRef after a short delay to allow next scan
          setTimeout(() => {
            scanProcessedRef.current = false;
          }, 1000);
        }
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

    };

    try {
      await html5QrCode.start(cameraConfig, config, handleScanSuccess, handleScanFailure);
      isRunningRef.current = true;
      // Brief delay to allow track to start before checking capabilities
      setTimeout(checkTorchSupport, 500);
    } catch (err) {

      try {
        await html5QrCode.clear().catch(() => { });
        const fallbackScanner = new Html5Qrcode(containerIdRef.current);
        scannerRef.current = fallbackScanner;
        // Use full container area for fallback scanner in inline mode
        const fallbackQrbox = inline && containerWidth && containerHeight
          ? { width: containerWidth - 10, height: containerHeight - 10 }
          : { width: 320, height: 150 };

        await fallbackScanner.start(
          cameraConfig,
          { fps: 10, qrbox: fallbackQrbox },
          handleScanSuccess,
          () => { }
        );
        isRunningRef.current = true;
      } catch (fallbackErr) {

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
          // Find back camera first
          // Priority: label contains 'back', 'rear', or 'environment' (case-insensitive)
          // If no back camera found, use first camera as fallback
          let backCameraIndex = 0;
          const foundIndex = devices.findIndex((device) => {
            const label = (device.label || '').toLowerCase();
            // Check label for back/rear/environment indicators
            return label.includes('back') ||
              label.includes('rear') ||
              label.includes('environment') ||
              label.includes('facing back') ||
              label.includes('facing: back');
          });

          if (foundIndex !== -1) {
            backCameraIndex = foundIndex;
          }

          setActiveCameraIndex(backCameraIndex);
          await startScanner(devices[backCameraIndex].id);
        } else {
          // No devices found, use environment facing mode as fallback
          await startScanner();
        }
      } catch (err) {

        // Fallback to environment facing mode (back camera)
        await startScanner();
      }
    };

    setupScanner();

    return () => {
      isMounted = false;
      stopScanner();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => { });
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
      console.error("Error switching camera:", err);
    } finally {
      setIsSwitchingCamera(false);
    }
  };

  const toggleTorch = async () => {
    if (!scannerRef.current || !isRunningRef.current || !isTorchSupported) return;

    try {
      const track = scannerRef.current.getRunningTrack();
      if (track) {
        const newState = !isTorchOn;
        await track.applyConstraints({
          advanced: [{ torch: newState }]
        });
        setIsTorchOn(newState);
      }
    } catch (err) {
      console.error("Error toggling torch:", err);
    }
  };

  const handleClose = async () => {
    await stopScanner();
    onCloseRef.current();
  };

  if (inline) {
    return (
      <div className={`relative w-full h-full bg-black rounded-lg overflow-hidden ${className}`}>
        <div
          id={containerIdRef.current}
          ref={qrReaderRef}
          className="w-full h-full"
          style={{
            minHeight: '100%',
            minWidth: '100%'
          }}
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-90">
            <div className="text-red-600 text-center p-2">
              <p className="text-xs font-medium">{error}</p>
            </div>
          </div>
        )}

        {/* Floating Controls for Inline Mode - Bottom Center Bar */}
        {!hideControls && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-black/60 backdrop-blur-lg rounded-2xl border border-white/10 p-1.5 shadow-2xl">
            {cameras.length > 1 && (
              <button
                onClick={handleSwitchCamera}
                disabled={isSwitchingCamera}
                className="px-4 py-2.5 flex items-center gap-2 text-white hover:bg-white/10 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                title="Switch Camera"
              >
                <RefreshCw className={`h-5 w-5 ${isSwitchingCamera ? 'animate-spin' : ''}`} />
                <span className="text-[11px] font-bold uppercase tracking-wider">Switch</span>
              </button>
            )}

            {/* Divider if both buttons exist */}
            {cameras.length > 1 && isTorchSupported && (
              <div className="w-px h-6 bg-white/20 mx-1"></div>
            )}

            {isTorchSupported && enableTorch && (
              <button
                onClick={toggleTorch}
                className={`px-4 py-2.5 flex items-center gap-2 rounded-xl transition-all active:scale-95 ${isTorchOn ? 'bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.4)]' : 'text-white hover:bg-white/10'
                  }`}
                title={isTorchOn ? "Turn Flash Off" : "Turn Flash On"}
              >
                {isTorchOn ? <ZapOff className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
                <span className="text-[11px] font-bold uppercase tracking-wider">{isTorchOn ? 'Off' : 'Flash'}</span>
              </button>
            )}

            {/* Fallback button if torch not detected yet but we're on mobile */}
            {!isTorchSupported && cameras.length > 0 && (
              <button
                onClick={() => {
                  // Force a re-check and try to toggle anyway
                  checkTorchSupport(0);
                  toggleTorch();
                }}
                className="px-4 py-2.5 flex items-center gap-2 text-white/40 hover:text-white rounded-xl transition-all text-[11px] font-bold uppercase tracking-wider"
                title="Try Flash"
              >
                <Zap className="h-5 w-5" />
                <span>Flash</span>
              </button>
            )}
          </div>
        )}
        {/* Dynamic styles for video and canvas elements */}
        <style dangerouslySetInnerHTML={{
          __html: `
            #${containerIdRef.current} video {
              width: 100% !important;
              height: 100% !important;
              object-fit: cover !important;
              border-radius: 0.5rem;
            }
            #${containerIdRef.current} canvas {
              width: 100% !important;
              height: 100% !important;
              border-radius: 0.5rem;
            }
          `
        }} />
      </div>
    );
  }

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
            {isTorchSupported && (
              <button
                onClick={toggleTorch}
                className={`p-2 rounded-lg transition-all ${isTorchOn ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  } border`}
                title={isTorchOn ? "Turn Flash Off" : "Turn Flash On"}
              >
                {isTorchOn ? <ZapOff className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
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
});

BarcodeScanner.displayName = 'BarcodeScanner';

export default BarcodeScanner;
