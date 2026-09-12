import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A股热力榜｜成交量、成交额、涨幅、换手率 Top 50",
  description: "自选股票与日期区间的样本走势多因子相似股票筛选，以及A股成交量、成交额、涨幅和换手率Top50。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
