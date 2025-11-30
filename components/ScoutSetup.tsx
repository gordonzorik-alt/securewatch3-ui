'use client';

import { useState, useRef, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

interface Message {
  id: string;
  type: 'scout' | 'user' | 'action' | 'device';
  content: string;
  action?: 'scanning' | 'connecting' | 'success' | 'error';
  device?: {
    ip: string;
    port: number;
    vendor: string;
  };
  inputType?: 'password' | 'text' | 'name';
  inputPlaceholder?: string;
}

interface DiscoveredCamera {
  ip: string;
  port: number;
  vendor: string;
  suggestedUrl: string;
  needsAuth: boolean;
}

interface ScoutSetupProps {
  onComplete: () => void;
  onCancel: () => void;
}

export default function ScoutSetup({ onComplete, onCancel }: ScoutSetupProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [inputType, setInputType] = useState<'text' | 'password' | 'name'>('text');
  const [inputPlaceholder, setInputPlaceholder] = useState('Type your response...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<DiscoveredCamera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<DiscoveredCamera | null>(null);
  const [cameraName, setCameraName] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'welcome' | 'scanning' | 'found' | 'password' | 'naming' | 'saving' | 'done' | 'notfound'>('welcome');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Initial welcome message
    setTimeout(() => {
      addMessage('scout', "Hi there! I'm Scout, your camera setup companion. I'll help you get your security camera online in just a few steps.");
      setTimeout(() => {
        addMessage('scout', "To make this easy, I can scan your Wi-Fi network to find cameras automatically. Ready to start?");
        setInputPlaceholder("Type 'yes' or click Scan Network");
      }, 1000);
    }, 500);
  }, []);

  const addMessage = (type: Message['type'], content: string, extra?: Partial<Message>) => {
    const msg: Message = {
      id: Date.now().toString() + Math.random(),
      type,
      content,
      ...extra,
    };
    setMessages(prev => [...prev, msg]);
  };

  const handleScan = async () => {
    setStep('scanning');
    setIsProcessing(true);
    addMessage('action', 'Scanning your network...', { action: 'scanning' });

    try {
      const response = await fetch(`${API_BASE}/api/setup/scan`);
      const data = await response.json();

      if (data.success && data.cameras.length > 0) {
        setDiscoveredCameras(data.cameras);
        setStep('found');

        // Remove scanning message and add success
        setMessages(prev => prev.filter(m => m.action !== 'scanning'));

        if (data.cameras.length === 1) {
          const cam = data.cameras[0];
          addMessage('scout', `Great news! I found a camera on your network:`);
          addMessage('device', `${cam.vendor} Camera`, { device: cam });
          setTimeout(() => {
            addMessage('scout', "To connect to it securely, I'll need the camera's password. This is usually set when you first configured the camera.");
            setInputType('password');
            setInputPlaceholder('Enter camera password');
            setSelectedCamera(cam);
            setStep('password');
          }, 1000);
        } else {
          addMessage('scout', `I found ${data.cameras.length} cameras on your network! Please select the one you'd like to set up:`);
          data.cameras.forEach((cam: DiscoveredCamera) => {
            addMessage('device', `${cam.vendor} Camera`, { device: cam });
          });
        }
      } else {
        setStep('notfound');
        setMessages(prev => prev.filter(m => m.action !== 'scanning'));
        addMessage('scout', "I couldn't find any cameras on this network yet. Let's troubleshoot:");
        addMessage('scout', "1. Is the camera plugged into power?\n2. Does the camera have a light showing it's connected to Wi-Fi?\n3. Is your device on the same Wi-Fi network as the camera?");
        setTimeout(() => {
          addMessage('scout', "Once you've checked those, would you like me to scan again, or would you prefer to enter the camera details manually?");
          setInputPlaceholder("Type 'scan' or 'manual'");
        }, 1500);
      }
    } catch (error) {
      setMessages(prev => prev.filter(m => m.action !== 'scanning'));
      addMessage('scout', "I had trouble scanning the network. Let's try again in a moment, or you can enter the camera details manually.");
      setStep('notfound');
    } finally {
      setIsProcessing(false);
    }
  };

  const selectCamera = (camera: DiscoveredCamera) => {
    setSelectedCamera(camera);
    addMessage('user', `Selected: ${camera.vendor} at ${camera.ip}`);
    setTimeout(() => {
      addMessage('scout', `Great choice! To connect to your ${camera.vendor} camera securely, I'll need its password.`);
      setInputType('password');
      setInputPlaceholder('Enter camera password');
      setStep('password');
    }, 500);
  };

  const handlePasswordSubmit = async () => {
    if (!password || !selectedCamera) return;

    addMessage('user', '••••••••');
    setIsProcessing(true);
    addMessage('action', 'Testing connection...', { action: 'connecting' });

    try {
      // Store credentials
      await fetch(`${API_BASE}/api/camera/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: 'test_' + selectedCamera.ip.split('.').pop(),
          snapshotUrl: selectedCamera.suggestedUrl,
          username: 'admin',
          password: password,
        }),
      });

      // Test snapshot
      const testResponse = await fetch(
        `${API_BASE}/api/camera/snapshot/test_${selectedCamera.ip.split('.').pop()}?t=${Date.now()}`
      );

      setMessages(prev => prev.filter(m => m.action !== 'connecting'));

      if (testResponse.ok) {
        addMessage('action', 'Connection successful!', { action: 'success' });
        setTimeout(() => {
          addMessage('scout', "Perfect! I can see the video feed. Now, what would you like to name this camera? Pick something easy to remember like 'Front Door' or 'Backyard'.");
          setInputType('name');
          setInputPlaceholder("e.g., Front Door, Backyard");
          setStep('naming');
        }, 1000);
      } else {
        addMessage('action', 'Connection failed', { action: 'error' });
        addMessage('scout', "That password didn't seem to work. Double-check for capital letters or typos and let's try again.");
        setPassword('');
      }
    } catch (error) {
      setMessages(prev => prev.filter(m => m.action !== 'connecting'));
      addMessage('scout', "I had trouble connecting. Let's try that password again.");
      setPassword('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNameSubmit = async () => {
    if (!cameraName || !selectedCamera) return;

    addMessage('user', cameraName);
    setIsProcessing(true);
    addMessage('action', 'Saving camera...', { action: 'connecting' });

    try {
      const response = await fetch(`${API_BASE}/api/monitor/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: cameraName.toLowerCase().replace(/\s+/g, '_'),
          sourceUrl: selectedCamera.suggestedUrl,
          mode: 'HTTP',
          username: 'admin',
          password: password,
          confidence: 0.7,
        }),
      });

      const data = await response.json();
      setMessages(prev => prev.filter(m => m.action !== 'connecting'));

      if (data.success) {
        addMessage('action', 'Camera added!', { action: 'success' });
        setTimeout(() => {
          addMessage('scout', `All set! "${cameraName}" is now active and monitoring for activity. You'll see it on your dashboard.`);
          setStep('done');
        }, 1000);
      } else {
        addMessage('scout', "Something went wrong while saving. Let's try a different name.");
      }
    } catch (error) {
      setMessages(prev => prev.filter(m => m.action !== 'connecting'));
      addMessage('scout', "I had trouble saving the camera. Let's try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;

    const value = inputValue.trim().toLowerCase();

    if (step === 'welcome') {
      if (value === 'yes' || value === 'y' || value === 'ok' || value === 'sure') {
        addMessage('user', 'Yes, let\'s do it!');
        setInputValue('');
        handleScan();
      }
    } else if (step === 'notfound') {
      if (value === 'scan' || value === 'yes' || value === 'again') {
        addMessage('user', 'Scan again');
        setInputValue('');
        handleScan();
      } else if (value === 'manual') {
        addMessage('user', 'Manual setup');
        addMessage('scout', "No problem! Please enter the camera's IP address (like 192.168.1.100):");
        setInputPlaceholder('192.168.1.100');
        setInputType('text');
        // Handle manual setup...
      }
    } else if (step === 'password') {
      setPassword(inputValue);
      setInputValue('');
      handlePasswordSubmit();
    } else if (step === 'naming') {
      setCameraName(inputValue);
      setInputValue('');
      handleNameSubmit();
    }

    setInputValue('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md h-[600px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-xl">🔍</span>
            </div>
            <div>
              <h2 className="text-white font-bold">Scout</h2>
              <p className="text-white/70 text-xs">Camera Setup Assistant</p>
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.type === 'scout' && (
                <div className="flex gap-2 max-w-[85%]">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">🔍</span>
                  </div>
                  <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100">
                    <p className="text-gray-800 text-sm whitespace-pre-line">{msg.content}</p>
                  </div>
                </div>
              )}

              {msg.type === 'user' && (
                <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%]">
                  <p className="text-sm">{msg.content}</p>
                </div>
              )}

              {msg.type === 'action' && (
                <div className="flex gap-2 max-w-[85%]">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    {msg.action === 'scanning' && (
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    )}
                    {msg.action === 'connecting' && (
                      <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    )}
                    {msg.action === 'success' && <span className="text-green-600">✓</span>}
                    {msg.action === 'error' && <span className="text-red-600">✗</span>}
                  </div>
                  <div className={`rounded-2xl rounded-tl-sm px-4 py-3 ${
                    msg.action === 'success' ? 'bg-green-50 border border-green-200' :
                    msg.action === 'error' ? 'bg-red-50 border border-red-200' :
                    'bg-blue-50 border border-blue-200'
                  }`}>
                    <p className={`text-sm font-medium ${
                      msg.action === 'success' ? 'text-green-700' :
                      msg.action === 'error' ? 'text-red-700' :
                      'text-blue-700'
                    }`}>
                      {msg.content}
                    </p>
                    {msg.action === 'scanning' && (
                      <div className="mt-2 h-1.5 bg-blue-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: '60%' }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {msg.type === 'device' && msg.device && (
                <div className="flex gap-2 max-w-[85%]">
                  <div className="w-8 h-8" />
                  <button
                    onClick={() => step === 'found' && discoveredCameras.length > 1 && selectCamera(msg.device!)}
                    className={`bg-white rounded-xl px-4 py-3 shadow-sm border-2 border-purple-200 hover:border-purple-400 transition-all ${
                      discoveredCameras.length > 1 ? 'cursor-pointer' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-gray-800">{msg.device.vendor}</p>
                        <p className="text-xs text-gray-500 font-mono">{msg.device.ip}:{msg.device.port}</p>
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {step !== 'done' ? (
          <div className="p-4 border-t border-gray-200 bg-white">
            {step === 'welcome' && (
              <div className="flex gap-2">
                <button
                  onClick={handleScan}
                  disabled={isProcessing}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Scan Network
                </button>
              </div>
            )}

            {(step === 'password' || step === 'naming' || step === 'notfound') && (
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  ref={inputRef}
                  type={inputType === 'password' ? 'password' : 'text'}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={inputPlaceholder}
                  disabled={isProcessing}
                  autoComplete="off"
                  data-1p-ignore
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
                <button
                  type="submit"
                  disabled={isProcessing || !inputValue.trim()}
                  className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </form>
            )}

            {step === 'scanning' && (
              <div className="text-center py-2 text-gray-500 text-sm">
                Scanning your network...
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 border-t border-gray-200 bg-white">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setMessages([]);
                  setStep('welcome');
                  setSelectedCamera(null);
                  setPassword('');
                  setCameraName('');
                  setDiscoveredCameras([]);
                  setTimeout(() => {
                    addMessage('scout', "Let's set up another camera! Ready to scan?");
                  }, 300);
                }}
                className="flex-1 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                Add Another Camera
              </button>
              <button
                onClick={onComplete}
                className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
