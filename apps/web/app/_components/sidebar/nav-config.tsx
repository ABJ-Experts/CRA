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

export interface NavLeaf {
  label: string;
  href: string;
  /** Count badge. Renders as `99+` above 99, matching the frame. */
  notice?: number;
}

export interface NavItem {
  label: string;
  href?: string;
  icon: LucideIcon;
  notice?: number;
  children?: NavLeaf[];
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
        children: [
          { label: "E-commerce", href: "/dashboard" },
          { label: "Analytics", href: "/dashboard/analytics" },
          { label: "Crypto", href: "/dashboard/crypto", notice: 3 },
          { label: "Project", href: "/dashboard/project" },
        ],
      },
      {
        label: "Tables",
        icon: Table2,
        children: [
          { label: "Basic", href: "/dashboard/tables" },
          { label: "Data grid", href: "/dashboard/tables/grid" },
        ],
      },
      { label: "Messages", icon: MessageSquare, href: "/dashboard/messages", notice: 7 },
      { label: "Email", icon: Mail, href: "/dashboard/email" },
      {
        label: "E-commerce",
        icon: ShoppingCart,
        children: [
          { label: "Products", href: "/dashboard/products" },
          { label: "Orders", href: "/dashboard/orders", notice: 12 },
        ],
      },
      {
        label: "Finance",
        icon: Wallet,
        children: [{ label: "Invoices", href: "/dashboard/invoices" }],
      },
      {
        label: "Logistic",
        icon: Truck,
        children: [
          { label: "Fleet", href: "/dashboard/fleet" },
          { label: "Routes", href: "/dashboard/routes" },
        ],
      },
      { label: "Management", icon: Settings2, href: "/dashboard/management" },
      { label: "Calendar", icon: Calendar, href: "/dashboard/calendar" },
      { label: "Help Center", icon: LifeBuoy, href: "/dashboard/help" },
      { label: "File Manager", icon: Folder, href: "/dashboard/files" },
    ],
  },
  {
    label: "Admin Authorization",
    items: [
      {
        label: "Profile",
        icon: UserRound,
        children: [
          { label: "Account", href: "/dashboard/account" },
          { label: "Security", href: "/dashboard/security" },
        ],
      },
      {
        label: "Authorization",
        icon: ShieldCheck,
        children: [
          { label: "Roles", href: "/dashboard/roles" },
          { label: "Permissions", href: "/dashboard/permissions" },
        ],
      },
      { label: "Docs", icon: FileText, href: "/showcase" },
    ],
  },
];
