import { LayoutGrid, Package, ShieldAlert } from "lucide-react";
import type { NavSection } from "../../_components/sidebar/nav-config";

/**
 * Navigation for the real CRA Sentinel product, distinct from the template's
 * demo NAV in _components/sidebar/nav-config.tsx.
 *
 * Kept flat and short on purpose. The demo nav exists to show off a component
 * library, so it has depth for its own sake; this one mirrors what the API
 * actually serves today — dashboard, products, findings — and grows only when a
 * screen behind it exists. A nav item that leads nowhere is worse than a
 * missing one, because it reads as a broken feature rather than an absent one.
 */
export const APP_NAV: NavSection[] = [
  {
    items: [
      { label: "Dashboard", icon: LayoutGrid, href: "/app/dashboard" },
      { label: "Products", icon: Package, href: "/app/products" },
      { label: "Findings", icon: ShieldAlert, href: "/app/findings" },
    ],
  },
];
