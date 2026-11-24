import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://fod-sec.github.io"),
  title: {
    default: "The Secretariat | Event Coordination",
    template: "%s | The Secretariat",
  },
  description: "A secure workspace for event programs, attendance confirmations, and room assignments.",
  applicationName: "The Secretariat",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/white-logo.png", type: "image/png" }],
    shortcut: "/white-logo.png",
    apple: "/white-logo.png",
  },
  openGraph: {
    type: "website",
    url: "https://fod-sec.github.io",
    siteName: "The Secretariat",
    title: "The Secretariat | Event Coordination",
    description: "A secure workspace for event programs, attendance confirmations, and room assignments.",
    locale: "en_PH",
    images: [{
      url: "/opengraph-image.png",
      width: 1200,
      height: 630,
      alt: "The Secretariat — Event Programs, Attendance, and Room Assignments",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Secretariat | Event Coordination",
    description: "A secure workspace for event programs, attendance confirmations, and room assignments.",
    images: ["/opengraph-image.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
