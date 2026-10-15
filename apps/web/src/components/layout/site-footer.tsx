import Link from 'next/link';
import { Logo } from './site-header';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">
            A noncommercial university project exploring AI-powered virtual try-on. Results show how
            a garment could look - they do not predict physical fit.
          </p>
        </div>
        <nav aria-label="Product" className="space-y-2 text-sm">
          <p className="font-semibold">Product</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link className="hover:text-foreground" href="/try-on">
                Try-On Studio
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/wardrobe">
                Wardrobe
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/favorites">
                Favorites
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Account" className="space-y-2 text-sm">
          <p className="font-semibold">Your data</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link className="hover:text-foreground" href="/profile">
                Profile
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/settings">
                Privacy &amp; settings
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        VirtualFit AI - university research prototype. Not for commercial use.
      </div>
    </footer>
  );
}
