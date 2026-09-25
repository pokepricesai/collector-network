'use client';

// Renders children into a portal at document.body — pulls the modal
// out of the page's flow so it can never be clipped, restacked or
// intercepted by a later opaque element (e.g. Footer background) no
// matter how tall the surrounding page is.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function DialogPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
