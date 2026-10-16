'use client';
import { usePathname } from 'next/navigation';
import { SiteHeader } from './site-header';
import { SiteFooter } from './site-footer';

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const nova = pathname === '/nova';
  return (
    <>
      {!nova && <SiteHeader />}
      <main id="main" className="flex-1">
        {children}
      </main>
      {!nova && <SiteFooter />}
    </>
  );
}
