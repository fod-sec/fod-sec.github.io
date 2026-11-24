import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Secretariat | Program & Billeting",
  description: "Program, attendance confirmation, and room assignments for The Secretariat.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
