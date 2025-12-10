'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

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
}

interface DiscoveredCamera {
  ip: string;
  port: number;
  vendor: string;
  suggestedUrl: string;
  needsAuth: boolean;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function SetupPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [inputType, setInputType] = useState<'text' | 'password' | 'name'>('text');
  const [inputPlaceholder, setInputPlaceholder] = useState('Type your response or ask a question...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<DiscoveredCamera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<DiscoveredCamera | null>(null);
  const [cameraName, setCameraName] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'welcome' | 'scanning' | 'found' | 'password' | 'naming' | 'saving' | 'done' | 'notfound' | 'manual'>('welcome');
  const [manualUrl, setManualUrl] = useState('');
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

    // Track conversation history for LLM context
    if (type === 'scout' || type === 'user') {
      setConversationHistory(prev => [...prev, {
        role: type === 'user' ? 'user' : 'assistant',
        content
      }]);
    }
  };

  // Check if message looks like a question or free-form text
  const isQuestion = (text: string): boolean => {
    const lower = text.toLowerCase().trim();
    // Skip if it's clearly a setup-flow response
    const setupResponses = ['yes', 'y', 'ok', 'sure', 'no', 'n', 'scan', 'manual', 'again'];
    if (setupResponses.includes(lower)) return false;
    // Check for question patterns
    const questionPatterns = [
      /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|will|have)/i,
      /\?$/,
      /help/i,
      /tell me/i,
      /explain/i,
      /i('m| am) (confused|not sure|stuck)/i,
    ];
    return questionPatterns.some(pattern => pattern.test(lower));
  };

  // Send message to LLM for free-form questions
  const askScout = async (userMessage: string) => {
    addMessage('user', userMessage);
    setIsThinking(true);

    try {
      const response = await fetch(`${API_BASE}/api/scout/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: conversationHistory.slice(-10),
        }),
      });

      const data = await response.json();
      setIsThinking(false);

      if (data.success && data.response) {
        addMessage('scout', data.response);
      } else if (data.fallbackResponse) {
        addMessage('scout', data.fallbackResponse);
      } else {
        addMessage('scout', "I'm not quite sure about that. Let's focus on getting your camera set up - click 'Scan Network' when you're ready!");
      }
    } catch (error) {
      setIsThinking(false);
      addMessage('scout', "Hmm, I had a little trouble there. Feel free to ask again, or we can continue with the setup!");
    }
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
          addMessage('scout', `I found ${data.cameras.length} cameras on your network! Click on the one you'd like to set up:`);
          data.cameras.forEach((cam: DiscoveredCamera) => {
            addMessage('device', `${cam.vendor} Camera`, { device: cam });
          });
        }
      } else {
        setStep('notfound');
        setMessages(prev => prev.filter(m => m.action !== 'scanning'));
        addMessage('scout', "I couldn't find any cameras on this network yet. Here are a few things to check:");
        addMessage('scout', "1. Is the camera plugged into power?\n2. Does the camera have a light showing it's connected to Wi-Fi?\n3. Is your device on the same Wi-Fi network as the camera?");
        setTimeout(() => {
          addMessage('scout', "Once you've checked those, would you like me to scan again, or would you prefer to enter the camera URL manually?");
          setInputPlaceholder("Type 'scan' or 'manual'");
        }, 1500);
      }
    } catch (error) {
      setMessages(prev => prev.filter(m => m.action !== 'scanning'));
      addMessage('scout', "I had trouble scanning the network. You can try again or enter the camera details manually.");
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
          addMessage('scout', `All set! "${cameraName}" is now active and monitoring for activity. You can see it on your dashboard.`);
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

  const handleManualSubmit = () => {
    if (!manualUrl) return;

    // Parse URL to extract IP
    let ip = 'manual';
    try {
      const url = new URL(manualUrl);
      ip = url.hostname;
    } catch {
      ip = manualUrl.split('/')[2]?.split(':')[0] || 'manual';
    }

    const camera: DiscoveredCamera = {
      ip: ip,
      port: 80,
      vendor: 'Manual Entry',
      suggestedUrl: manualUrl,
      needsAuth: true,
    };

    setSelectedCamera(camera);
    addMessage('user', `URL: ${manualUrl}`);
    setTimeout(() => {
      addMessage('scout', "Got it! Now I'll need the camera's password to connect.");
      setInputType('password');
      setInputPlaceholder('Enter camera password');
      setStep('password');
    }, 500);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing || isThinking) return;

    const originalValue = inputValue.trim();
    const value = originalValue.toLowerCase();

    if (!originalValue) return;

    // Check if it's a question/free-form text at any step (except password/naming)
    if (step !== 'password' && step !== 'naming' && step !== 'manual' && isQuestion(originalValue)) {
      setInputValue('');
      askScout(originalValue);
      return;
    }

    if (step === 'welcome') {
      if (value === 'yes' || value === 'y' || value === 'ok' || value === 'sure') {
        addMessage('user', 'Yes, let\'s do it!');
        setInputValue('');
        handleScan();
      } else {
        // Free-form text that's not a question - send to LLM anyway
        setInputValue('');
        askScout(originalValue);
        return;
      }
    } else if (step === 'notfound') {
      if (value === 'scan' || value === 'yes' || value === 'again') {
        addMessage('user', 'Scan again');
        setInputValue('');
        handleScan();
      } else if (value === 'manual') {
        addMessage('user', 'Manual setup');
        addMessage('scout', "No problem! Please enter the camera's snapshot URL. For Hikvision cameras, it's usually like:\nhttp://192.168.1.100:8001/ISAPI/Streaming/channels/101/picture");
        setInputPlaceholder('http://192.168.1.100:8001/...');
        setInputType('text');
        setStep('manual');
        setInputValue('');
        return;
      } else {
        // Unknown input - send to LLM
        setInputValue('');
        askScout(originalValue);
        return;
      }
    } else if (step === 'found') {
      // User typed something while cameras are displayed - send to LLM
      setInputValue('');
      askScout(originalValue);
      return;
    } else if (step === 'manual') {
      // Check if it looks like a URL
      if (originalValue.startsWith('http') || originalValue.includes('://') || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(originalValue)) {
        setManualUrl(originalValue);
        setInputValue('');
        handleManualSubmit();
      } else {
        // Not a URL - send to LLM
        setInputValue('');
        askScout(originalValue);
      }
      return;
    } else if (step === 'password') {
      setPassword(originalValue);
      setInputValue('');
      handlePasswordSubmit();
      return;
    } else if (step === 'naming') {
      setCameraName(originalValue);
      setInputValue('');
      handleNameSubmit();
      return;
    } else if (step === 'done') {
      // User can still ask questions after setup is complete
      setInputValue('');
      askScout(originalValue);
      return;
    }

    setInputValue('');
  };

  const resetSetup = () => {
    setMessages([]);
    setStep('welcome');
    setSelectedCamera(null);
    setPassword('');
    setCameraName('');
    setDiscoveredCameras([]);
    setManualUrl('');
    setInputValue('');
    setTimeout(() => {
      addMessage('scout', "Let's set up another camera! Ready to scan?");
    }, 300);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">🔍</span>
            </div>
            <div>
              <h1 className="text-white font-bold text-xl">Scout</h1>
              <p className="text-white/70 text-sm">Camera Setup Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/setup-demo"
              className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-sm rounded-lg transition-colors flex items-center gap-1.5"
            >
              <span>▶</span> View Demo
            </Link>
            <Link
              href="/"
              className="text-white/70 hover:text-white transition-colors text-sm"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden flex flex-col h-[calc(100vh-200px)]">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.type === 'scout' && (
                  <div className="flex gap-3 max-w-[85%]">
                    <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-lg">🔍</span>
                    </div>
                    <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                      <p className="text-gray-800 whitespace-pre-line">{msg.content}</p>
                    </div>
                  </div>
                )}

                {msg.type === 'user' && (
                  <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%]">
                    <p>{msg.content}</p>
                  </div>
                )}

                {msg.type === 'action' && (
                  <div className="flex gap-3 max-w-[85%]">
                    <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      {msg.action === 'scanning' && (
                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      )}
                      {msg.action === 'connecting' && (
                        <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                      )}
                      {msg.action === 'success' && <span className="text-green-600 text-lg">✓</span>}
                      {msg.action === 'error' && <span className="text-red-600 text-lg">✗</span>}
                    </div>
                    <div className={`rounded-2xl rounded-tl-sm px-4 py-3 ${
                      msg.action === 'success' ? 'bg-green-50 border border-green-200' :
                      msg.action === 'error' ? 'bg-red-50 border border-red-200' :
                      'bg-blue-50 border border-blue-200'
                    }`}>
                      <p className={`font-medium ${
                        msg.action === 'success' ? 'text-green-700' :
                        msg.action === 'error' ? 'text-red-700' :
                        'text-blue-700'
                      }`}>
                        {msg.content}
                      </p>
                      {msg.action === 'scanning' && (
                        <div className="mt-2 h-2 bg-blue-200 rounded-full overflow-hidden w-48">
                          <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: '60%' }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {msg.type === 'device' && msg.device && (
                  <div className="flex gap-3 max-w-[85%]">
                    <div className="w-9 h-9" />
                    <button
                      onClick={() => step === 'found' && discoveredCameras.length > 1 && selectCamera(msg.device!)}
                      disabled={step !== 'found' || discoveredCameras.length <= 1}
                      className={`bg-white rounded-xl px-5 py-4 shadow-sm border-2 border-purple-200 transition-all ${
                        step === 'found' && discoveredCameras.length > 1
                          ? 'hover:border-purple-400 cursor-pointer hover:shadow-md'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center">
                          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-gray-800 text-lg">{msg.device.vendor}</p>
                          <p className="text-sm text-gray-500 font-mono">{msg.device.ip}:{msg.device.port}</p>
                        </div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator when waiting for LLM response */}
            {isThinking && (
              <div className="flex justify-start">
                <div className="flex gap-3 max-w-[85%]">
                  <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">🔍</span>
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1 items-center">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-3">
            {step === 'welcome' && (
              <div className="flex gap-3">
                <button
                  onClick={handleScan}
                  disabled={isProcessing || isThinking}
                  className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-lg"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Scan Network
                </button>
                <button
                  onClick={() => {
                    addMessage('user', 'Enter manually');
                    addMessage('scout', "No problem! Please enter the camera's snapshot URL:");
                    setInputPlaceholder('http://192.168.1.100:8001/...');
                    setStep('manual');
                  }}
                  disabled={isThinking}
                  className="px-6 py-4 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-700 font-medium rounded-xl transition-colors"
                >
                  Manual
                </button>
              </div>
            )}

            {(step === 'password' || step === 'naming' || step === 'notfound' || step === 'manual') && (
              <form onSubmit={handleSubmit} className="flex gap-3">
                <input
                  type={inputType === 'password' ? 'password' : 'text'}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={inputPlaceholder}
                  disabled={isProcessing || isThinking}
                  autoComplete="off"
                  data-1p-ignore
                  className="flex-1 px-5 py-4 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 text-lg"
                />
                <button
                  type="submit"
                  disabled={isProcessing || isThinking || !inputValue.trim()}
                  className="px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </form>
            )}

            {step === 'scanning' && (
              <div className="text-center py-4 text-gray-500">
                Scanning your network...
              </div>
            )}

            {step === 'found' && discoveredCameras.length > 1 && (
              <div className="text-center py-2 text-gray-500 text-sm">
                Click a camera above to select it
              </div>
            )}

            {step === 'done' && (
              <div className="flex gap-3">
                <button
                  onClick={resetSetup}
                  className="flex-1 py-4 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Add Another Camera
                </button>
                <Link href="/" className="flex-1">
                  <button className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors">
                    Go to Dashboard
                  </button>
                </Link>
              </div>
            )}

            {/* Always show question input (except during scanning) */}
            {step !== 'scanning' && step !== 'password' && step !== 'naming' && step !== 'manual' && step !== 'notfound' && (
              <form onSubmit={handleSubmit} className="flex gap-3">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Ask Scout a question..."
                  disabled={isProcessing || isThinking}
                  autoComplete="off"
                  data-1p-ignore
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                />
                <button
                  type="submit"
                  disabled={isProcessing || isThinking || !inputValue.trim()}
                  className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-400">
            Supported: Hikvision, Dahua, Reolink, Axis, Ubiquiti, and more
          </p>
        </div>
      </main>
    </div>
  );
}
