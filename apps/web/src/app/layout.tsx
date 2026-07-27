import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Auction House",
  description: "Secure sealed-bid auction platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
