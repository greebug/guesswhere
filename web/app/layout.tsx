import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Guesswhere",
  description: "Guess the city from satellite imagery alone.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* The backdrop is fixed and -z-10, so it costs the play screen nothing
          (MainMap paints over all of it) while giving every other screen a
          sky to sit on. */}
      <body className="min-h-full flex flex-col">
        <SpaceBackdrop />
        {children}
      </body>
    </html>
  );
}
