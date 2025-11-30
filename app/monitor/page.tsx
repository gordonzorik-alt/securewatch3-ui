'use client';

import dynamic from 'next/dynamic';

// Dynamic import to avoid Turbopack chunk loading issues
const ThreatDashboard = dynamic(
  () => import('@/components/ThreatDashboard'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading Monitor...</div>
      </div>
    )
  }
);

export default function MonitorPage() {
  return <ThreatDashboard />;
}
