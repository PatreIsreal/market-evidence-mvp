import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "市场证据台｜A股大势研究",
  description: "基于可追溯数据理解市场状态、主要矛盾与判断条件。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
