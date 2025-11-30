'use client';

import { useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

interface DiscoveredCamera {
  ip: string;
  port: number;
  vendor: string;
  model: string;
  needsAuth: boolean;
  suggestedUrl: string;
  status: string;
}

interface SetupWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

export default function SetupWizard({ onComplete, onCancel }: SetupWizardProps) {
  const [step, setStep] = useState<'scan' | 'configure' | 'test' | 'done'>('scan');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<DiscoveredCamera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<DiscoveredCamera | null>(null);
  const [cameraName, setCameraName] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startScan = async () => {
    setIsScanning(true);
    setScanResults([]);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/setup/scan`);
      const data = await response.json();

      if (data.success) {
        setScanResults(data.cameras);
      } else {
        setError(data.error || 'Scan failed');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setIsScanning(false);
    }
  };

  const selectCamera = (camera: DiscoveredCamera) => {
    setSelectedCamera(camera);
    setCameraName(`camera_${camera.ip.split('.').pop()}`);
    setStep('configure');
  };

  const testConnection = async () => {
    if (!selectedCamera) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      // Try to fetch a snapshot to test credentials
      const response = await fetch(`${API_BASE}/api/camera/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: cameraName,
          snapshotUrl: selectedCamera.suggestedUrl,
          username,
          password,
        }),
      });

      if (response.ok) {
        // Now try to get a snapshot
        const snapshotResponse = await fetch(
          `${API_BASE}/api/camera/snapshot/${cameraName}?t=${Date.now()}`
        );

        if (snapshotResponse.ok) {
          setTestResult('success');
        } else {
          setTestResult('fail');
        }
      } else {
        setTestResult('fail');
      }
    } catch (err) {
      setTestResult('fail');
    } finally {
      setIsTesting(false);
    }
  };

  const addCamera = async () => {
    if (!selectedCamera) return;

    setIsAdding(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/monitor/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: cameraName,
          sourceUrl: selectedCamera.suggestedUrl,
          mode: 'HTTP',
          username,
          password,
          confidence: 0.7,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setStep('done');
      } else {
        setError(data.error || 'Failed to add camera');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setIsAdding(false);
    }
  };

  const addAnother = () => {
    setStep('scan');
    setSelectedCamera(null);
    setCameraName('');
    setPassword('');
    setTestResult(null);
    setScanResults([]);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">Camera Setup Wizard</h2>
                <p className="text-white/70 text-sm">
                  {step === 'scan' && 'Step 1: Find Cameras'}
                  {step === 'configure' && 'Step 2: Configure'}
                  {step === 'test' && 'Step 3: Test Connection'}
                  {step === 'done' && 'Complete!'}
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="text-white/70 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress Bar */}
          <div className="flex gap-2 mt-4">
            {['scan', 'configure', 'test', 'done'].map((s, idx) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  ['scan', 'configure', 'test', 'done'].indexOf(step) >= idx
                    ? 'bg-white'
                    : 'bg-white/30'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* Step 1: Scan */}
          {step === 'scan' && (
            <div className="space-y-4">
              {!isScanning && scanResults.length === 0 && (
                <div className="text-center py-8">
                  <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Find Cameras on Your Network</h3>
                  <p className="text-gray-500 text-sm mb-6">
                    We'll scan your local network to automatically discover security cameras.
                  </p>
                  <button
                    onClick={startScan}
                    className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-purple-200"
                  >
                    Start Scanning
                  </button>
                </div>
              )}

              {isScanning && (
                <div className="text-center py-8">
                  <div className="relative w-20 h-20 mx-auto mb-4">
                    <div className="absolute inset-0 border-4 border-purple-200 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                    <div className="absolute inset-3 border-4 border-blue-200 rounded-full"></div>
                    <div className="absolute inset-3 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Scanning Network...</h3>
                  <p className="text-gray-500 text-sm">
                    Probing local devices for cameras. This may take a minute.
                  </p>
                </div>
              )}

              {!isScanning && scanResults.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800">
                      Found {scanResults.length} Camera{scanResults.length > 1 ? 's' : ''}
                    </h3>
                    <button
                      onClick={startScan}
                      className="text-sm text-purple-600 hover:text-purple-700"
                    >
                      Scan Again
                    </button>
                  </div>

                  {scanResults.map((cam, idx) => (
                    <button
                      key={idx}
                      onClick={() => selectCamera(cam)}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl hover:border-purple-300 hover:bg-purple-50 transition-all text-left group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center">
                            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-800">{cam.vendor}</div>
                            <div className="text-sm text-gray-500 font-mono">{cam.ip}:{cam.port}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {cam.needsAuth && (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">
                              Password Required
                            </span>
                          )}
                          <svg className="w-5 h-5 text-gray-400 group-hover:text-purple-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!isScanning && scanResults.length === 0 && error && (
                <div className="text-center py-4">
                  <p className="text-red-500 text-sm">{error}</p>
                </div>
              )}

              {/* Manual Entry Option */}
              <div className="pt-4 border-t border-gray-200">
                <p className="text-center text-sm text-gray-500">
                  Camera not found?{' '}
                  <button
                    onClick={() => {
                      setSelectedCamera({
                        ip: '',
                        port: 8001,
                        vendor: 'Manual',
                        model: '',
                        needsAuth: true,
                        suggestedUrl: '',
                        status: 'manual',
                      });
                      setStep('configure');
                    }}
                    className="text-purple-600 hover:text-purple-700 font-medium"
                  >
                    Enter IP manually
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 'configure' && selectedCamera && (
            <div className="space-y-4">
              {selectedCamera.vendor !== 'Manual' && (
                <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800">{selectedCamera.vendor}</div>
                      <div className="text-sm text-gray-500 font-mono">{selectedCamera.ip}:{selectedCamera.port}</div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Camera Name</label>
                <input
                  value={cameraName}
                  onChange={(e) => setCameraName(e.target.value)}
                  placeholder="e.g., front_door, backyard"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
                />
              </div>

              {selectedCamera.vendor === 'Manual' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Snapshot URL</label>
                  <input
                    value={selectedCamera.suggestedUrl}
                    onChange={(e) => setSelectedCamera({ ...selectedCamera, suggestedUrl: e.target.value })}
                    placeholder="http://192.168.1.100:8001/ISAPI/Streaming/channels/101/picture"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    autoComplete="off"
                    data-1p-ignore
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="new-password"
                    data-1p-ignore
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep('scan')}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={testConnection}
                  disabled={!cameraName || !password || isTesting}
                  className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors"
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>
              </div>

              {testResult === 'success' && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Connection Successful!
                  </div>
                  <button
                    onClick={addCamera}
                    disabled={isAdding}
                    className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-colors"
                  >
                    {isAdding ? 'Adding Camera...' : 'Add Camera & Start Monitoring'}
                  </button>
                </div>
              )}

              {testResult === 'fail' && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-center gap-2 text-red-700 font-medium">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Connection Failed - Check credentials
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Camera Added Successfully!</h3>
              <p className="text-gray-500 text-sm mb-6">
                <strong>{cameraName}</strong> is now monitoring for threats.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={addAnother}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Add Another Camera
                </button>
                <button
                  onClick={onComplete}
                  className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
