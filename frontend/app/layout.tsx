import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "AI Receptionist",
  description: "Manage your business workspace.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
