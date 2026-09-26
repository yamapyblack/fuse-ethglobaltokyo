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
                <span className="logo-mark" />
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
