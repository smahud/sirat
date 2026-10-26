import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "SIRAT — Sistem Informasi Registrasi & Arsip Surat",
    template: "%s · SIRAT",
  },
  description:
    "Registrasi nomor surat resmi dan arsip digital YAPSI Darussalam — konsisten, aman, dan teraudit.",
  applicationName: "SIRAT",
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d5c46",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
