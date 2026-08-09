import {
  Calendar,
  FileText,
  Folder,
  LayoutGrid,
  LifeBuoy,
  Mail,
  MessageSquare,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Table2,
  Truck,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { MenuKey } from "@repo/contracts/menu";

export interface NavLeaf {
  label: string;
  href: string;
  /** Count badge. Renders as `99+` above 99, matching the frame. */
  notice?: number;
  /**
   * RBAC key for this entry. Maps to a `menu_permissions` row and to
   * `MENU_PERMISSION_MAP` in `@repo/contracts/menu`, which decides whether the
   * item renders. `menu-nav-parity.spec.ts` asserts this tree and the contract's
   * `MENU_KEYS` stay identical in both directions, so an entry can never be
   * added here without a way to grant it.
   */
  menuKey: MenuKey;
}

export interface NavItem {
  label: string;
  href?: string;
  icon: LucideIcon;
  notice?: number;
  children?: NavLeaf[];
  menuKey: MenuKey;
}

export interface NavSection {
  /** Rendered as the frame's 10px SemiBold section caption. */
  label?: string;
  items: NavItem[];
}

/**
 * The navigation from Pencil frame `ty4xx`, item for item.
 *
 * Kept as data rather than markup so the expanded rail, the collapsed rail
 * and the mobile drawer all render from one source - three hand-written
 * copies would drift the moment a route is added.
 */
export const NAV: NavSection[] = [
  {
    items: [
      {
        label: "Dashboard",
        icon: LayoutGrid,
        notice: 128,
        menuKey: "dashboard",
        children: [
          {
            label: "E-commerce",
            href: "/dashboard",
            menuKey: "dashboard.ecommerce",
          },
          {
            label: "Analytics",
            href: "/dashboard/analytics",
            menuKey: "dashboard.analytics",
          },
          {
            label: "Crypto",
            href: "/dashboard/crypto",
            notice: 3,
            menuKey: "dashboard.crypto",
          },
          {
            label: "Project",
            href: "/dashboard/project",
            menuKey: "dashboard.project",
          },
        ],
      },
      {
        label: "Tables",
        icon: Table2,
        menuKey: "tables",
        /* The four skins the Pencil frames ship, in the order they appear
         * there: Basic, Striped, Bordered, Splitted. */
        children: [
          {
            label: "Basic",
            href: "/dashboard/tables/basic",
            menuKey: "tables.basic",
          },
          {
            label: "Striped",
            href: "/dashboard/tables/striped",
            menuKey: "tables.striped",
          },
          {
            label: "Bordered",
            href: "/dashboard/tables/bordered",
            menuKey: "tables.bordered",
          },
          {
            label: "Splitted",
            href: "/dashboard/tables/splitted",
            menuKey: "tables.splitted",
          },
        ],
      },
      {
        label: "Messages",
        icon: MessageSquare,
        href: "/dashboard/messages",
        notice: 7,
        menuKey: "messages",
      },
      {
        label: "Email",
        icon: Mail,
        href: "/dashboard/email",
        menuKey: "email",
      },
      {
        label: "E-commerce",
        icon: ShoppingCart,
        menuKey: "ecommerce",
        children: [
          {
            label: "Products",
            href: "/dashboard/products",
            menuKey: "ecommerce.products",
          },
          {
            label: "Orders",
            href: "/dashboard/orders",
            notice: 12,
            menuKey: "ecommerce.orders",
          },
        ],
      },
      {
        label: "Finance",
        icon: Wallet,
        menuKey: "finance",
        children: [
          {
            label: "Invoices",
            href: "/dashboard/invoices",
            menuKey: "finance.invoices",
          },
        ],
      },
      {
        label: "Logistic",
        icon: Truck,
        menuKey: "logistic",
        children: [
          {
            label: "Fleet",
            href: "/dashboard/fleet",
            menuKey: "logistic.fleet",
          },
          {
            label: "Routes",
            href: "/dashboard/routes",
            menuKey: "logistic.routes",
          },
        ],
      },
      {
        label: "Management",
        icon: Settings2,
        href: "/dashboard/management",
        menuKey: "management",
      },
      {
        label: "Calendar",
        icon: Calendar,
        href: "/dashboard/calendar",
        menuKey: "calendar",
      },
      {
        label: "Help Center",
        icon: LifeBuoy,
        href: "/dashboard/help",
        menuKey: "help",
      },
      {
        label: "File Manager",
        icon: Folder,
        href: "/dashboard/files",
        menuKey: "files",
      },
    ],
  },
  {
    label: "Admin Authorization",
    items: [
      {
        label: "Profile",
        icon: UserRound,
        menuKey: "profile",
        children: [
          {
            label: "Account",
            href: "/dashboard/account",
            menuKey: "profile.account",
          },
          {
            label: "Security",
            href: "/dashboard/security",
            menuKey: "profile.security",
          },
        ],
      },
      {
        label: "Authorization",
        icon: ShieldCheck,
        menuKey: "authorization",
        children: [
          {
            label: "Roles",
            href: "/dashboard/roles",
            menuKey: "authorization.roles",
          },
          {
            label: "Permissions",
            href: "/dashboard/permissions",
            menuKey: "authorization.permissions",
          },
        ],
      },
      { label: "Docs", icon: FileText, href: "/showcase", menuKey: "docs" },
    ],
  },
];
