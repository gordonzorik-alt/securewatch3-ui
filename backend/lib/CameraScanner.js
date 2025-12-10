import findLocalDevices from 'local-devices';
import net from 'net';
import http from 'http';
import https from 'https';

// =============================================================================
// Camera MAC OUI Database (IEEE Registered Prefixes)
// Comprehensive list including Big Three commercial + consumer + white-label
// =============================================================================
const CAMERA_VENDORS = {
  // Hikvision (70+ OUIs - largest manufacturer)
  '00:bc:99': 'Hikvision', '04:03:12': 'Hikvision', '08:3b:c1': 'Hikvision',
  '08:54:11': 'Hikvision', '08:a1:89': 'Hikvision', '08:cc:81': 'Hikvision',
  '0c:75:d2': 'Hikvision', '10:12:fb': 'Hikvision', '18:68:cb': 'Hikvision',
  '18:80:25': 'Hikvision', '24:0f:9b': 'Hikvision', '24:28:fd': 'Hikvision',
  '24:32:ae': 'Hikvision', '24:48:45': 'Hikvision', '28:57:be': 'Hikvision',
  '2c:a5:9c': 'Hikvision', '34:09:62': 'Hikvision', '3c:1b:f8': 'Hikvision',
  '40:ac:bf': 'Hikvision', '44:19:b6': 'Hikvision', '44:47:cc': 'Hikvision',
  '44:a6:42': 'Hikvision', '4c:1f:86': 'Hikvision', '4c:62:df': 'Hikvision',
  '4c:bd:8f': 'Hikvision', '4c:f5:dc': 'Hikvision', '50:e5:38': 'Hikvision',
  '54:8c:81': 'Hikvision', '54:c4:15': 'Hikvision', '58:03:fb': 'Hikvision',
  '58:50:ed': 'Hikvision', '5c:34:5b': 'Hikvision', '64:db:8b': 'Hikvision',
  '68:6d:bc': 'Hikvision', '74:3f:c2': 'Hikvision', '80:48:9f': 'Hikvision',
  '80:7c:62': 'Hikvision', '80:be:af': 'Hikvision', '80:f5:ae': 'Hikvision',
  '84:94:59': 'Hikvision', '84:9a:40': 'Hikvision', '88:de:39': 'Hikvision',
  '8c:e7:48': 'Hikvision', '94:e1:ac': 'Hikvision', '98:8b:0a': 'Hikvision',
  '98:9d:e5': 'Hikvision', '98:df:82': 'Hikvision', '98:f1:12': 'Hikvision',
  'a0:ff:0c': 'Hikvision', 'a4:14:37': 'Hikvision', 'a4:29:02': 'Hikvision',
  'a4:4b:d9': 'Hikvision', 'a4:a4:59': 'Hikvision', 'a4:d5:c2': 'Hikvision',
  'ac:b9:2f': 'Hikvision', 'ac:cb:51': 'Hikvision', 'b4:a3:82': 'Hikvision',
  'bc:5e:33': 'Hikvision', 'bc:9b:5e': 'Hikvision', 'bc:ad:28': 'Hikvision',
  'bc:ba:c2': 'Hikvision', 'c0:51:7e': 'Hikvision', 'c0:56:e3': 'Hikvision',
  'c0:6d:ed': 'Hikvision', 'c4:2f:90': 'Hikvision', 'c8:a7:02': 'Hikvision',
  'd4:e8:53': 'Hikvision', 'dc:07:f8': 'Hikvision', 'dc:d2:6a': 'Hikvision',
  'e0:ba:ad': 'Hikvision', 'e0:ca:3c': 'Hikvision', 'e0:df:13': 'Hikvision',
  'e4:d5:8b': 'Hikvision', 'e8:a0:ed': 'Hikvision', 'ec:a9:71': 'Hikvision',
  'ec:c8:9c': 'Hikvision', 'f8:4d:fc': 'Hikvision', 'fc:9f:fd': 'Hikvision',

  // Dahua
  '38:af:29': 'Dahua', 'e0:50:8b': 'Dahua', '14:d6:7c': 'Dahua',
  '4c:d7:c8': 'Dahua', '6c:68:a4': 'Dahua', 'b4:64:15': 'Dahua',
  '90:02:a9': 'Dahua', '9c:14:63': 'Dahua', 'a0:bd:1d': 'Dahua',

  // Axis Communications
  '00:40:8c': 'Axis', 'ac:cc:8e': 'Axis', 'b8:a4:4f': 'Axis', 'e8:27:25': 'Axis',

  // Ring (Amazon)
  '18:7f:88': 'Ring', '24:2b:d6': 'Ring', '34:3e:a4': 'Ring', '54:e0:19': 'Ring',
  '5c:47:5e': 'Ring', '64:9a:63': 'Ring', '90:48:6c': 'Ring', '9c:76:13': 'Ring',
  'ac:9f:c3': 'Ring', 'c4:db:ad': 'Ring', 'cc:3b:fb': 'Ring',

  // Google Nest
  '18:b4:30': 'Google Nest', '64:16:66': 'Google Nest', 'd8:2a:5e': 'Google Nest',
  'f4:f5:d8': 'Google Nest', '1c:5a:3e': 'Google Nest',

  // Arlo
  '48:62:64': 'Arlo', 'a4:11:62': 'Arlo', 'fc:9c:98': 'Arlo', '2c:30:33': 'Arlo',

  // Reolink
  'ec:71:db': 'Reolink', 'b4:6b:fc': 'Reolink',

  // Amcrest
  '9c:8e:cd': 'Amcrest',

  // Ubiquiti (UniFi Protect)
  '24:5a:4c': 'Ubiquiti', 'fc:ec:da': 'Ubiquiti', '80:2a:a8': 'Ubiquiti',
  '68:d7:9a': 'Ubiquiti', '78:8a:20': 'Ubiquiti', 'f4:92:bf': 'Ubiquiti',
  '74:83:c2': 'Ubiquiti', 'dc:9f:db': 'Ubiquiti', 'e0:63:da': 'Ubiquiti',

  // TP-Link / Tapo
  '50:c7:bf': 'TP-Link', '98:da:c4': 'TP-Link', 'b0:be:76': 'TP-Link',
  'c0:06:c3': 'TP-Link', '54:af:97': 'TP-Link', '60:32:b1': 'TP-Link',

  // Wyze
  '2c:aa:8e': 'Wyze', 'd0:3f:27': 'Wyze', '7c:78:b2': 'Wyze',

  // Eufy
  '8c:85:80': 'Eufy', '78:da:07': 'Eufy', 'ac:e3:4e': 'Eufy',

  // Foscam
  'c0:30:fb': 'Foscam', '00:62:6e': 'Foscam',

  // Lorex
  '2c:28:2d': 'Lorex', '70:b3:d5': 'Lorex',

  // Swann
  '00:20:18': 'Swann',

  // Samsung (SmartThings)
  '78:ab:bb': 'Samsung', 'c4:73:1e': 'Samsung', 'd0:fc:cc': 'Samsung',

  // Bosch
  '00:07:5f': 'Bosch', '00:1a:6b': 'Bosch', '00:04:13': 'Bosch',

  // Hanwha (Samsung Techwin)
  '00:09:18': 'Hanwha', '00:16:6c': 'Hanwha', 'f8:e4:3b': 'Hanwha',

  // Vivotek
  '00:02:d1': 'Vivotek', '00:19:6d': 'Vivotek',

  // Mobotix
  '00:19:2d': 'Mobotix',

  // Sony
  '00:04:1f': 'Sony', 'fc:f1:52': 'Sony', 'b4:52:7d': 'Sony',

  // Panasonic
  '00:1a:2b': 'Panasonic', '00:80:45': 'Panasonic', 'b0:c4:e7': 'Panasonic',

  // Tuya / Smart Life (White-label IoT)
  '7c:f6:66': 'Tuya', 'd8:1f:12': 'Tuya', '84:e3:42': 'Tuya',
  '10:d5:61': 'Tuya', '48:55:19': 'Tuya', 'a8:48:fa': 'Tuya',

  // Espressif (ESP32/ESP8266 - common in cheap cameras)
  '24:0a:c4': 'Espressif', '30:ae:a4': 'Espressif', '84:cc:a8': 'Espressif',
  'a4:cf:12': 'Espressif', 'ac:67:b2': 'Espressif', 'bc:dd:c2': 'Espressif',

  // Realtek (common IP camera chipset)
  '00:e0:4c': 'Realtek Chipset',

  // Generic IP Camera patterns
  'e8:ab:fa': 'Generic IP Camera',
  '00:0c:43': 'Generic IP Camera',
};

// Common camera ports to check
const CAMERA_PORTS = [80, 443, 554, 8000, 8001, 8080, 8443, 37777];

// =============================================================================
// Port Scanner (Native TCP)
// =============================================================================
async function checkPort(ip, port, timeout = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, ip);
  });
}

async function checkPorts(ip, ports = CAMERA_PORTS) {
  const results = await Promise.all(
    ports.map(async (port) => {
      const isOpen = await checkPort(ip, port);
      return isOpen ? port : null;
    })
  );
  return results.filter(Boolean);
}

// =============================================================================
// Vendor Lookup
// =============================================================================
function getVendorFromMac(mac) {
  if (!mac) return 'Unknown';
  const prefix = mac.substring(0, 8).toLowerCase();
  return CAMERA_VENDORS[prefix] || 'Unknown';
}

// =============================================================================
// Network Scanner
// =============================================================================
export async function scanNetwork() {
  console.log('[CameraScanner] Starting network scan...');

  try {
    // Step 1: Get all devices on local network via ARP table
    const devices = await findLocalDevices();
    console.log(`[CameraScanner] Found ${devices.length} devices on network`);

    const cameras = [];

    // Step 2: Check each device
    for (const device of devices) {
      const vendor = getVendorFromMac(device.mac);

      // If known camera vendor, prioritize scanning
      const isKnownVendor = vendor !== 'Unknown';

      // Scan ports
      const openPorts = await checkPorts(device.ip);

      // A device is likely a camera if:
      // 1. It's from a known camera vendor, OR
      // 2. It has RTSP (554) or common camera ports open
      const hasRTSP = openPorts.includes(554);
      const hasCameraPorts = openPorts.some(p => [8000, 8001, 37777].includes(p));

      if (isKnownVendor || hasRTSP || hasCameraPorts) {
        cameras.push({
          ip: device.ip,
          mac: device.mac,
          vendor: vendor,
          ports: openPorts,
          hasRTSP,
          confidence: isKnownVendor ? 'high' : (hasRTSP ? 'medium' : 'low'),
        });
      }
    }

    console.log(`[CameraScanner] Found ${cameras.length} potential cameras`);
    return {
      success: true,
      totalDevices: devices.length,
      cameras,
    };
  } catch (error) {
    console.error('[CameraScanner] Scan failed:', error);
    return {
      success: false,
      error: error.message,
      cameras: [],
    };
  }
}

// =============================================================================
// Camera Authentication Test
// =============================================================================
export async function testCameraAuth(ip, port, username, password) {
  console.log(`[CameraScanner] Testing auth for ${ip}:${port}`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: 'Connection timeout' });
    }, 5000);

    // Try HTTP Basic Auth first
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const options = {
      hostname: ip,
      port: port,
      path: '/',
      method: 'GET',
      timeout: 5000,
      headers: {
        'Authorization': `Basic ${auth}`,
      },
    };

    const protocol = port === 443 || port === 8443 ? https : http;

    const req = protocol.request(options, (res) => {
      clearTimeout(timeout);

      if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
        resolve({ success: true, message: 'Authentication successful' });
      } else if (res.statusCode === 401) {
        resolve({ success: false, error: '401 Unauthorized - Invalid credentials' });
      } else if (res.statusCode === 403) {
        resolve({ success: false, error: '403 Forbidden - Access denied' });
      } else {
        resolve({ success: true, message: `Connected (HTTP ${res.statusCode})` });
      }
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `Connection failed: ${err.message}` });
    });

    req.on('timeout', () => {
      clearTimeout(timeout);
      req.destroy();
      resolve({ success: false, error: 'Request timeout' });
    });

    req.end();
  });
}

// =============================================================================
// Remote Stream Verification
// =============================================================================
export async function verifyRemoteStream(externalUrl) {
  console.log(`[CameraScanner] Verifying remote access: ${externalUrl}`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: 'Connection timeout' });
    }, 10000);

    try {
      const url = new URL(externalUrl);
      const protocol = url.protocol === 'https:' ? https : http;
      const port = url.port || (url.protocol === 'https:' ? 443 : 80);

      const options = {
        hostname: url.hostname,
        port: port,
        path: url.pathname || '/',
        method: 'GET',
        timeout: 10000,
      };

      const req = protocol.request(options, (res) => {
        clearTimeout(timeout);

        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve({
            success: true,
            message: 'Remote connection established',
            statusCode: res.statusCode,
            hostname: url.hostname,
            port: port,
          });
        } else {
          resolve({
            success: false,
            error: `Server returned HTTP ${res.statusCode}`,
            statusCode: res.statusCode,
          });
        }
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        if (err.code === 'ENOTFOUND') {
          resolve({ success: false, error: 'DNS lookup failed - hostname not found' });
        } else if (err.code === 'ECONNREFUSED') {
          resolve({ success: false, error: 'Connection refused - port forwarding may not be configured' });
        } else if (err.code === 'ETIMEDOUT') {
          resolve({ success: false, error: 'Connection timed out - port may be blocked' });
        } else {
          resolve({ success: false, error: `Connection failed: ${err.message}` });
        }
      });

      req.on('timeout', () => {
        clearTimeout(timeout);
        req.destroy();
        resolve({ success: false, error: 'Request timeout - port may be blocked or unreachable' });
      });

      req.end();
    } catch (err) {
      clearTimeout(timeout);
      resolve({ success: false, error: `Invalid URL: ${err.message}` });
    }
  });
}

// =============================================================================
// RTSP Stream Test
// =============================================================================
export async function testRTSPStream(ip, port = 554, username, password, path = '/Streaming/Channels/1') {
  console.log(`[CameraScanner] Testing RTSP stream at ${ip}:${port}`);

  // Just check if port is open for now
  // Full RTSP handshake would require more complex protocol handling
  const isOpen = await checkPort(ip, port, 2000);

  if (!isOpen) {
    return { success: false, error: 'RTSP port not responding' };
  }

  const rtspUrl = username && password
    ? `rtsp://${username}:${password}@${ip}:${port}${path}`
    : `rtsp://${ip}:${port}${path}`;

  return {
    success: true,
    message: 'RTSP port is open',
    rtspUrl: rtspUrl.replace(/:.*@/, ':***@'), // Mask password in response
  };
}

export default {
  scanNetwork,
  testCameraAuth,
  verifyRemoteStream,
  testRTSPStream,
  CAMERA_VENDORS,
  CAMERA_PORTS,
};
