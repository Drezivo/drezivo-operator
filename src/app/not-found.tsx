import Image from "next/image";
import Link from "next/link";

import { NotFoundBackButton } from "@/components/NotFoundBackButton";

/**
 * The Drezivo 404. The same layout and copy ship in the workspace, landing site and storefronts
 * (Drezivo/drezivo app and web); only the primary action differs.
 */
export default function NotFound() {
  return (
    <main className="not-found">
      <span aria-hidden="true" className="not-found-numeral">404</span>
      <div className="not-found-body">
        <Link href="/" aria-label="Drezivo operator console" className="not-found-brand">
          <Image src="/drezivo-mark.png" alt="" width={35} height={42} />
          <span className="brand-name">Drezivo</span>
        </Link>
        <p className="eyebrow not-found-eyebrow">Error 404</p>
        <h1>Page not found</h1>
        <span aria-hidden="true" className="not-found-rule" />
        <p className="not-found-copy">The page you are looking for does not exist or has moved.</p>
        <div className="not-found-actions">
          <Link href="/" className="pill-button pill-primary">Back to console</Link>
          <NotFoundBackButton />
        </div>
      </div>
    </main>
  );
}
