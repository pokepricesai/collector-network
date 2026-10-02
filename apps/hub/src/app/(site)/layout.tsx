import type { ReactNode } from 'react';
import '../globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

// Public-site shell. Wraps the four public pages with the shared
// header + footer + base styles. Admin lives at /admin outside
// this group and therefore does not inherit any of this.

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
