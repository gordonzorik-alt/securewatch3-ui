'use client';

import React, { useState, useEffect, useRef } from 'react';

// Synthetic customer scenario: "Martinez Auto Body Shop"
// 4 cameras being installed at a small business

interface Device {
  ip: string;
  mac: string;
  vendor: string;
  model?: string;
  ports: number[];
  unlocked: boolean;
  rtspUrl?: string;
  snapshotOk?: boolean;
  snapshotData?: string;
  name: string;
  mode: 'priority' | 'standard';
  enabled: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'scout' | 'system';
  content: string;
  timestamp: Date;
}

// Mock data for Martinez Auto Body Shop
const MOCK_DEVICES: Device[] = [
  {
    ip: '192.168.1.101',
    mac: 'AA:BB:CC:11:22:33',
    vendor: 'Hikvision',
    model: 'DS-2CD2143G2-I',
    ports: [554, 80, 8000],
    unlocked: false,
    name: 'front_entrance',
    mode: 'priority',
    enabled: true,
  },
  {
    ip: '192.168.1.102',
    mac: 'AA:BB:CC:11:22:34',
    vendor: 'Hikvision',
    model: 'DS-2CD2143G2-I',
    ports: [554, 80, 8000],
    unlocked: false,
    name: 'service_bay',
    mode: 'priority',
    enabled: true,
  },
  {
    ip: '192.168.1.103',
    mac: 'AA:BB:CC:11:22:35',
    vendor: 'Dahua',
    model: 'IPC-HDW2831T-AS',
    ports: [554, 80],
    unlocked: false,
    name: 'back_lot',
    mode: 'standard',
    enabled: true,
  },
  {
    ip: '192.168.1.104',
    mac: 'AA:BB:CC:11:22:36',
    vendor: 'Reolink',
    model: 'RLC-810A',
    ports: [554, 80],
    unlocked: false,
    name: 'office',
    mode: 'standard',
    enabled: true,
  },
];

// Simulated Scout responses based on step
const SCOUT_RESPONSES: Record<string, { say: string; quickReplies?: string[] }> = {
  welcome: {
    say: "Welcome to SecureWatch! I'm Scout, your camera setup assistant. I see you're setting up cameras for Martinez Auto Body Shop. Ready to get started?",
    quickReplies: ['Scan Network', 'Manual Setup'],
  },
  scanning: {
    say: 'Scanning your local network for cameras... This usually takes 15-30 seconds.',
  },
  found: {
    say: "Excellent! I found 4 cameras on your network:\n\n- 2x Hikvision DS-2CD2143G2-I\n- 1x Dahua IPC-HDW2831T-AS\n- 1x Reolink RLC-810A\n\nThese look like a solid setup for an auto shop. Let's unlock them with your credentials.",
    quickReplies: ['Enter Credentials', 'Skip for Now'],
  },
  credentials: {
    say: "I'll need your site-wide camera credentials. Most installers use the same username/password for all cameras on a site.",
    quickReplies: ['Use Default (admin)', 'Custom Credentials'],
  },
  unlocking: {
    say: 'Testing credentials on all 4 cameras...',
  },
  unlocked: {
    say: "All 4 cameras unlocked successfully! Now let's verify the video streams are working.",
    quickReplies: ['Verify Streams', 'Skip Verification'],
  },
  verifying: {
    say: 'Capturing test snapshots from each camera...',
  },
  verified: {
    say: "All streams verified! I can see:\n\n- Front entrance: Clear view of main door\n- Service bay: Good coverage of work area\n- Back lot: Parking area visible\n- Office: Interior coverage\n\nNow let's configure names and priority modes.",
    quickReplies: ['Configure Cameras', 'Use Defaults'],
  },
  configure: {
    say: "Based on your auto shop layout, I recommend:\n\n**Priority Mode** (faster alerts):\n- Front Entrance - catches customer arrivals\n- Service Bay - monitors valuable equipment\n\n**Standard Mode**:\n- Back Lot - general surveillance\n- Office - interior monitoring\n\nDoes this look right?",
    quickReplies: ['Looks Good', 'Customize'],
  },
  generating: {
    say: 'Generating your detection.json configuration...',
  },
  complete: {
    say: "Your SecureWatch configuration is ready!\n\n**Martinez Auto Body Shop**\n- 4 cameras configured\n- 2 priority, 2 standard\n- Motion-gated detection enabled\n\nDownload the config file and place it in your SecureWatch folder to activate.",
    quickReplies: ['Download Config', 'Start Over'],
  },
};

type WizardStep = 'welcome' | 'scanning' | 'found' | 'credentials' | 'unlocking' | 'unlocked' | 'verifying' | 'verified' | 'configure' | 'generating' | 'complete';

export default function SetupDemoPage() {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [showConfigPreview, setShowConfigPreview] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initial welcome message
  useEffect(() => {
    const timer = setTimeout(() => {
      addScoutMessage(SCOUT_RESPONSES.welcome.say, SCOUT_RESPONSES.welcome.quickReplies);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const addMessage = (role: ChatMessage['role'], content: string) => {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, msg]);
  };

  const addScoutMessage = (content: string, _quickReplies?: string[]) => {
    addMessage('scout', content);
  };

  const addSystemMessage = (content: string) => {
    addMessage('system', content);
  };

  // Simulate network scan
  const simulateScan = async () => {
    setStep('scanning');
    addScoutMessage(SCOUT_RESPONSES.scanning.say);
    setIsProcessing(true);

    // Simulate progress
    for (let i = 1; i <= 4; i++) {
      await new Promise((r) => setTimeout(r, 800));
      addSystemMessage(`Found device ${i}/4...`);
    }

    await new Promise((r) => setTimeout(r, 500));
    setDevices(MOCK_DEVICES);
    setStep('found');
    setIsProcessing(false);
    addScoutMessage(SCOUT_RESPONSES.found.say, SCOUT_RESPONSES.found.quickReplies);
  };

  // Simulate credential test
  const simulateUnlock = async () => {
    setStep('unlocking');
    addScoutMessage(SCOUT_RESPONSES.unlocking.say);
    setIsProcessing(true);
    setShowCredentialModal(false);

    for (let i = 0; i < MOCK_DEVICES.length; i++) {
      await new Promise((r) => setTimeout(r, 600));
      addSystemMessage(`Unlocked ${MOCK_DEVICES[i].vendor} at ${MOCK_DEVICES[i].ip}`);
      setDevices((prev) =>
        prev.map((d, idx) =>
          idx === i
            ? { ...d, unlocked: true, rtspUrl: `rtsp://admin:password@${d.ip}:554/stream1` }
            : d
        )
      );
    }

    await new Promise((r) => setTimeout(r, 500));
    setStep('unlocked');
    setIsProcessing(false);
    addScoutMessage(SCOUT_RESPONSES.unlocked.say, SCOUT_RESPONSES.unlocked.quickReplies);
  };

  // Simulate stream verification
  const simulateVerify = async () => {
    setStep('verifying');
    addScoutMessage(SCOUT_RESPONSES.verifying.say);
    setIsProcessing(true);

    for (let i = 0; i < devices.length; i++) {
      await new Promise((r) => setTimeout(r, 700));
      addSystemMessage(`Verified stream: ${devices[i].name}`);
      setDevices((prev) =>
        prev.map((d, idx) => (idx === i ? { ...d, snapshotOk: true } : d))
      );
    }

    await new Promise((r) => setTimeout(r, 500));
    setStep('verified');
    setIsProcessing(false);
    addScoutMessage(SCOUT_RESPONSES.verified.say, SCOUT_RESPONSES.verified.quickReplies);
  };

  // Generate config
  const generateConfig = async () => {
    setStep('generating');
    addScoutMessage(SCOUT_RESPONSES.generating.say);
    setIsProcessing(true);

    await new Promise((r) => setTimeout(r, 1500));

    setStep('complete');
    setIsProcessing(false);
    addScoutMessage(SCOUT_RESPONSES.complete.say, SCOUT_RESPONSES.complete.quickReplies);
  };

  // Handle quick reply clicks
  const handleQuickReply = (reply: string) => {
    addMessage('user', reply);

    switch (reply) {
      case 'Scan Network':
        simulateScan();
        break;
      case 'Enter Credentials':
      case 'Custom Credentials':
        setShowCredentialModal(true);
        addScoutMessage(SCOUT_RESPONSES.credentials.say);
        break;
      case 'Use Default (admin)':
        simulateUnlock();
        break;
      case 'Verify Streams':
        simulateVerify();
        break;
      case 'Configure Cameras':
      case 'Looks Good':
        if (step === 'verified') {
          setStep('configure');
          addScoutMessage(SCOUT_RESPONSES.configure.say, SCOUT_RESPONSES.configure.quickReplies);
        } else if (step === 'configure') {
          generateConfig();
        }
        break;
      case 'Download Config':
        setShowConfigPreview(true);
        break;
      case 'Start Over':
        setMessages([]);
        setDevices([]);
        setStep('welcome');
        setTimeout(() => {
          addScoutMessage(SCOUT_RESPONSES.welcome.say, SCOUT_RESPONSES.welcome.quickReplies);
        }, 300);
        break;
      default:
        addScoutMessage("I understand. Let's continue with the setup.");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    addMessage('user', input);
    setInput('');

    // Simple response for demo
    setTimeout(() => {
      addScoutMessage("Got it! Let me help you with that. Use the quick reply buttons below to proceed with the setup.");
    }, 500);
  };

  // Get current quick replies based on step
  const getCurrentQuickReplies = (): string[] => {
    const stepReplies: Record<WizardStep, string[]> = {
      welcome: ['Scan Network', 'Manual Setup'],
      scanning: [],
      found: ['Enter Credentials', 'Skip for Now'],
      credentials: ['Use Default (admin)', 'Custom Credentials'],
      unlocking: [],
      unlocked: ['Verify Streams', 'Skip Verification'],
      verifying: [],
      verified: ['Configure Cameras', 'Use Defaults'],
      configure: ['Looks Good', 'Customize'],
      generating: [],
      complete: ['Download Config', 'Start Over'],
    };
    return stepReplies[step] || [];
  };

  // Generate detection.json config
  const generateDetectionJson = () => {
    const cameras: Record<string, object> = {};
    devices.forEach((d, idx) => {
      cameras[d.name] = {
        enabled: d.enabled,
        rtsp_url: `rtsp://127.0.0.1:8554/${d.name}`,
        priority: d.mode === 'priority' ? idx + 1 : idx + 3,
        _source_rtsp: d.rtspUrl,
      };
    });

    return JSON.stringify(
      {
        version: '2.0.0',
        description: 'Martinez Auto Body Shop - Motion-gated detection',
        detection: {
          confidence_threshold: 0.5,
          iou_threshold: 0.5,
          allowed_classes: ['person'],
          cooldown_seconds: 20,
          frame_skip: 15,
        },
        worker: {
          type: 'vision_worker_v4.py',
          model: 'yolo11n.pt',
        },
        cameras,
        redis: {
          host: 'localhost',
          port: 6379,
        },
      },
      null,
      2
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">SecureWatch Setup Wizard</h1>
            <p className="text-sm text-gray-400">Demo: Martinez Auto Body Shop</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="px-3 py-1 bg-blue-600 rounded-full text-sm">
              Step: {step}
            </span>
            <span className="px-3 py-1 bg-green-600 rounded-full text-sm">
              {devices.length} cameras
            </span>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Chat Panel */}
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600'
                      : msg.role === 'scout'
                      ? 'bg-gray-700'
                      : 'bg-gray-800 text-gray-400 text-sm'
                  }`}
                >
                  {msg.role === 'scout' && (
                    <div className="text-xs text-blue-400 mb-1 font-semibold">Scout</div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className="flex justify-start">
                <div className="bg-gray-700 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <span className="text-gray-400">Processing...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Replies */}
          {getCurrentQuickReplies().length > 0 && !isProcessing && (
            <div className="px-4 py-2 border-t border-gray-700">
              <div className="flex flex-wrap gap-2">
                {getCurrentQuickReplies().map((reply) => (
                  <button
                    key={reply}
                    onClick={() => handleQuickReply(reply)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                disabled={isProcessing}
              />
              <button
                type="submit"
                disabled={isProcessing || !input.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                Send
              </button>
            </div>
          </form>
        </div>

        {/* Device Panel */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
          <div className="p-4 border-b border-gray-700">
            <h2 className="font-semibold">Discovered Cameras</h2>
          </div>
          <div className="p-4 space-y-3">
            {devices.length === 0 ? (
              <p className="text-gray-500 text-sm">No cameras discovered yet</p>
            ) : (
              devices.map((device) => (
                <div
                  key={device.ip}
                  className="bg-gray-700 rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{device.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        device.mode === 'priority'
                          ? 'bg-orange-600'
                          : 'bg-gray-600'
                      }`}
                    >
                      {device.mode}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400">
                    <div>{device.vendor} {device.model}</div>
                    <div>{device.ip}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded ${
                        device.unlocked ? 'bg-green-600' : 'bg-gray-600'
                      }`}
                    >
                      {device.unlocked ? 'Unlocked' : 'Locked'}
                    </span>
                    {device.snapshotOk && (
                      <span className="px-2 py-0.5 rounded bg-blue-600">
                        Verified
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Credential Modal */}
      {showCredentialModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Camera Credentials</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  type="text"
                  defaultValue="admin"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  defaultValue="SecureWatch2024!"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCredentialModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => simulateUnlock()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                >
                  Test Credentials
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Config Preview Modal */}
      {showConfigPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-lg font-semibold mb-4">Generated Configuration</h3>
            <pre className="flex-1 bg-gray-900 rounded p-4 overflow-auto text-sm text-green-400">
              {generateDetectionJson()}
            </pre>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowConfigPreview(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([generateDetectionJson()], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'detection.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded"
              >
                Download File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
