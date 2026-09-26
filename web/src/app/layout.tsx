import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/ConnectButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fuse",
  description: "Burn two NFTs. An AI fuses them into one.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <header className="topbar">
              <Link href="/" className="logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="logo-mark" src="/logo.png" alt="" />
                Fuse
              </Link>
              <ConnectButton />
            </header>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
