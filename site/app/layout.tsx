import type { Metadata } from 'next';

import { assetUrl } from '@/app/lib/base-url';
import './globals.css';

const title = 'Melbourne TripAgent · 一句中文，排出能出发的墨尔本行程';
const description =
  '面向第一次到访墨尔本的中文旅行者：先核对需求与来源，再用确定性规划器排出 1–3 天行程；地点、时间、费用和换点都有据可查。';

export const metadata: Metadata = {
  title,
  description,
  icons: {
    icon: assetUrl('favicon.svg'),
  },
  openGraph: {
    title,
    description,
    locale: 'zh_CN',
    type: 'website',
    images: [
      {
        url: assetUrl('melbourne-skyline.webp'),
        width: 1600,
        height: 901,
        alt: '墨尔本城市天际线',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [assetUrl('melbourne-skyline.webp')],
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
