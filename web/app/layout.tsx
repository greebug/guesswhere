import type { Metadata } from "next";
import { Archivo, Fraunces, IBM_Plex_Mono } from "next/font/google";
import Backdrop from "@/components/Backdrop";
import "./globals.css";

// Three faces, three jobs, and deliberately none of the defaults. Inter,
// Geist and the system stack are what every generated UI ships with, and a
// typeface is the fastest thing a person reads as "this was designed" or not.
//
// Fraunces carries the display type: a variable serif whose `SOFT` and `WONK`
// axes give it a slight irregularity, which suits a game that shouldn't take
// itself too seriously. Archivo is the UI grotesque -- plain on purpose, it's
// the thing you read rather than look at. IBM Plex Mono handles every live
// number (timers, scores, join codes); its shapes are technical without being
// a terminal cosplay.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// "v2" is deliberate homage, not a version number: this is a rebuild of the
// original GuessWhere (guesswhere.vercel.app), whose idea the whole game comes
// from. The URL path stays /guesswhere -- it's load-bearing for the session
// cookie, every emailed link, and the hub Worker's routing.
export const metadata: Metadata = {
  title: "Guesswhere v2",
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
      className={`${fraunces.variable} ${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      {/* The backdrop is fixed and -z-10, so it costs the play screen nothing
          (MainMap paints over all of it) while giving every other screen a
          ground to sit on. */}
      <body className="min-h-full flex flex-col">
        <Backdrop />
        {children}
      </body>
    </html>
  );
}
