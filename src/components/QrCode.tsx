"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCode({ value, size = 132 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: "#16150f", light: "#fffdf8" } })
      .then(setSrc)
      .catch(() => setSrc(undefined));
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} className="rounded-lg bg-line/50" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="QR code to open the approval page on your phone" className="rounded-lg" />;
}
