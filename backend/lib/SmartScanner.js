/**
 * SmartScanner - Network Auto-Discovery for Security Cameras
 *
 * Scans local network for cameras using:
 * - ARP table scanning for device discovery
 * - MAC address OUI lookup for vendor identification
 * - Port probing for camera service detection
 * - HTTP endpoint probing for camera confirmation
 */

import net from 'net';
import { networkInterfaces } from 'os';

// Known camera vendor MAC prefixes (OUI - first 3 octets)
const CAMERA_VENDORS = {
  // Hikvision
  '28:57:be': 'Hikvision',
  'c0:56:e3': 'Hikvision',
  'a4:14:37': 'Hikvision',
  '54:c4:15': 'Hikvision',
  '44:19:b6': 'Hikvision',
  'c4:2f:90': 'Hikvision',
  'e0:50:8b': 'Hikvision',
  '8c:e7:48': 'Hikvision',
  'bc:ad:28': 'Hikvision',
  '4c:bd:8f': 'Hikvision',
  '80:1f:12': 'Hikvision',

  // Dahua
  '3c:ef:8c': 'Dahua',
  'a0:bd:1d': 'Dahua',
  '90:02:a9': 'Dahua',
  'e0:50:8b': 'Dahua',
  '4c:11:bf': 'Dahua',

  // Axis Communications
  '00:40:8c': 'Axis',
  'ac:cc:8e': 'Axis',
  'b8:a4:4f': 'Axis',

  // Amcrest
  '9c:8e:cd': 'Amcrest',

  // Reolink
  'ec:71:db': 'Reolink',

  // Espressif (ESP32 cameras)
  '24:6f:28': 'ESP32-CAM',
  '30:ae:a4': 'ESP32-CAM',
  'a4:cf:12': 'ESP32-CAM',

  // Ubiquiti
  'f0:9f:c2': 'Ubiquiti',
  '80:2a:a8': 'Ubiquiti',
  '68:72:51': 'Ubiquiti',

  // TP-Link
  '50:c7:bf': 'TP-Link',
  '60:a4:b7': 'TP-Link',

  // Wyze
  '2c:aa:8e': 'Wyze',
  'd0:3f:27': 'Wyze',
};

// Common camera ports
const CAMERA_PORTS = [80, 554, 8000, 8001, 8080, 8443, 443];

// Camera probe endpoints by vendor
const PROBE_ENDPOINTS = {
  'Hikvision': [
    { path: '/ISAPI/System/deviceInfo', name: 'ISAPI' },
    { path: '/ISAPI/Streaming/channels/101/picture', name: 'Snapshot' },
  ],
  'Dahua': [
    { path: '/cgi-bin/magicBox.cgi?action=getDeviceType', name: 'DeviceInfo' },
  ],
  'Axis': [
    { path: '/axis-cgi/param.cgi?action=list&group=Brand', name: 'Brand' },
  ],
  'default': [
    { path: '/', name: 'Root' },
    { path: '/cgi-bin/snapshot.cgi', name: 'Snapshot' },
  ]
};

class SmartScanner {
  constructor() {
    this.scanResults = [];
    this.scanning = false;
  }

  /**
   * Get local network subnet info
   */
  getLocalSubnet() {
    const interfaces = networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal and non-IPv4
        if (iface.internal || iface.family !== 'IPv4') continue;

        // Skip Docker/VM networks
        if (name.includes('docker') || name.includes('veth') || name.includes('br-')) continue;

        // Get subnet base (assume /24)
        const parts = iface.address.split('.');
        const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;

        return {
          localIp: iface.address,
          subnet: subnet,
          netmask: iface.netmask
        };
      }
    }

    return null;
  }

  /**
   * Check if a port is open on a host
   */
  checkPort(host, port, timeout = 2000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        resolved = true;
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.on('error', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      try {
        socket.connect(port, host);
      } catch (e) {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }
    });
  }

  /**
   * Probe HTTP endpoint to identify camera
   */
  async probeEndpoint(host, port, path, timeout = 3000) {
    const axios = (await import('axios')).default;
    const protocol = port === 443 || port === 8443 ? 'https' : 'http';
    const url = `${protocol}://${host}:${port}${path}`;

    try {
      const response = await axios.get(url, {
        timeout: timeout,
        validateStatus: (status) => true, // Accept any status
        httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false }),
        maxRedirects: 0,
      });

      // 401 means camera is there but needs auth - SUCCESS
      // 200 means open access - SUCCESS
      // 403 means forbidden but exists - SUCCESS
      if ([200, 401, 403, 301, 302].includes(response.status)) {
        return {
          success: true,
          status: response.status,
          headers: response.headers,
          needsAuth: response.status === 401,
        };
      }

      return { success: false, status: response.status };
    } catch (error) {
      // Connection refused or timeout = no camera
      return { success: false, error: error.code || error.message };
    }
  }

  /**
   * Identify vendor from MAC address
   */
  identifyVendor(mac) {
    if (!mac) return 'Unknown';

    const prefix = mac.toLowerCase().substring(0, 8);
    return CAMERA_VENDORS[prefix] || 'Unknown';
  }

  /**
   * Scan a single IP for camera services
   */
  async scanHost(ip, vendor = 'Unknown') {
    const results = [];

    // Check common camera ports
    for (const port of CAMERA_PORTS) {
      const isOpen = await this.checkPort(ip, port, 1500);

      if (isOpen) {
        // Try to identify the camera type
        const endpoints = PROBE_ENDPOINTS[vendor] || PROBE_ENDPOINTS['default'];
        let identified = false;
        let model = 'Unknown';
        let needsAuth = false;
        let snapshotPath = null;

        for (const endpoint of endpoints) {
          const probe = await this.probeEndpoint(ip, port, endpoint.path);

          if (probe.success) {
            identified = true;
            needsAuth = probe.needsAuth;

            // Check for Hikvision in headers
            if (probe.headers && probe.headers['server']) {
              const server = probe.headers['server'].toLowerCase();
              if (server.includes('hikvision')) {
                vendor = 'Hikvision';
                model = 'Hikvision NVR/Camera';
              } else if (server.includes('dahua')) {
                vendor = 'Dahua';
              }
            }

            // If this was the snapshot endpoint, record it
            if (endpoint.name === 'Snapshot' || endpoint.path.includes('picture')) {
              snapshotPath = endpoint.path;
            }

            break;
          }
        }

        if (identified) {
          results.push({
            ip,
            port,
            vendor: vendor !== 'Unknown' ? vendor : 'Generic Camera',
            model,
            needsAuth,
            snapshotPath,
            status: needsAuth ? 'requires_auth' : 'open',
          });
        }
      }
    }

    return results;
  }

  /**
   * Scan the entire local network for cameras
   */
  async scanNetwork(progressCallback = null) {
    if (this.scanning) {
      throw new Error('Scan already in progress');
    }

    this.scanning = true;
    this.scanResults = [];

    try {
      const subnetInfo = this.getLocalSubnet();

      if (!subnetInfo) {
        throw new Error('Could not determine local network');
      }

      console.log(`[SmartScanner] Scanning subnet ${subnetInfo.subnet}.0/24`);

      // First, try to get devices from ARP table using local-devices
      let knownDevices = [];
      try {
        const localDevices = (await import('local-devices')).default;
        knownDevices = await localDevices();
        console.log(`[SmartScanner] Found ${knownDevices.length} devices via ARP`);
      } catch (e) {
        console.log(`[SmartScanner] ARP scan failed: ${e.message}, falling back to full scan`);
      }

      // Build list of IPs to scan
      let ipsToScan = [];

      if (knownDevices.length > 0) {
        // Prioritize devices with known camera MAC prefixes
        const cameraDevices = knownDevices.filter(d => {
          const vendor = this.identifyVendor(d.mac);
          return vendor !== 'Unknown';
        });

        // Add camera devices first
        for (const device of cameraDevices) {
          ipsToScan.push({
            ip: device.ip,
            mac: device.mac,
            vendor: this.identifyVendor(device.mac),
          });
        }

        // Then add other devices
        for (const device of knownDevices) {
          if (!ipsToScan.find(d => d.ip === device.ip)) {
            ipsToScan.push({
              ip: device.ip,
              mac: device.mac,
              vendor: 'Unknown',
            });
          }
        }
      } else {
        // Fallback: scan common IP ranges
        for (let i = 1; i <= 254; i++) {
          ipsToScan.push({
            ip: `${subnetInfo.subnet}.${i}`,
            mac: null,
            vendor: 'Unknown',
          });
        }
      }

      // Scan IPs in parallel batches
      const batchSize = 20;
      const totalIps = ipsToScan.length;
      let scanned = 0;

      for (let i = 0; i < ipsToScan.length; i += batchSize) {
        const batch = ipsToScan.slice(i, i + batchSize);

        const batchResults = await Promise.all(
          batch.map(async (device) => {
            const results = await this.scanHost(device.ip, device.vendor);
            scanned++;

            if (progressCallback) {
              progressCallback({
                current: scanned,
                total: totalIps,
                percent: Math.round((scanned / totalIps) * 100),
                currentIp: device.ip,
                found: this.scanResults.length,
              });
            }

            return results;
          })
        );

        // Flatten and add to results
        for (const hostResults of batchResults) {
          this.scanResults.push(...hostResults);
        }
      }

      console.log(`[SmartScanner] Scan complete. Found ${this.scanResults.length} cameras`);

      return this.scanResults;
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Quick scan of a specific IP
   */
  async scanSingleIp(ip) {
    return await this.scanHost(ip, 'Unknown');
  }

  /**
   * Get suggested snapshot URL for a discovered camera
   */
  getSuggestedSnapshotUrl(camera) {
    const protocol = camera.port === 443 || camera.port === 8443 ? 'https' : 'http';

    if (camera.vendor === 'Hikvision') {
      return `${protocol}://${camera.ip}:${camera.port}/ISAPI/Streaming/channels/101/picture`;
    } else if (camera.vendor === 'Dahua') {
      return `${protocol}://${camera.ip}:${camera.port}/cgi-bin/snapshot.cgi`;
    } else if (camera.vendor === 'Axis') {
      return `${protocol}://${camera.ip}:${camera.port}/axis-cgi/jpg/image.cgi`;
    } else {
      return `${protocol}://${camera.ip}:${camera.port}/snapshot.jpg`;
    }
  }
}

// Export singleton instance
const smartScanner = new SmartScanner();
export default smartScanner;
