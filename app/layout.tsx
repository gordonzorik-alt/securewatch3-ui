import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers";
import Sidebar from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SecureWatch3 - Dispatch Console",
  description: "Video object detection dispatch console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900`}
      >
        <AppProviders>
          <div className="flex min-h-screen">
            <Sidebar />

            {/* Main content */}
            <main className="flex-1 md:ml-64 pt-16 md:pt-0">
              {children}
            </main>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
