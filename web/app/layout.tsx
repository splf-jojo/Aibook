import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canvas",
  description: "Private browser-to-Windows canvas transfer",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

