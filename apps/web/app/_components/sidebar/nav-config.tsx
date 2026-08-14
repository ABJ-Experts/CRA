import {
  Building2,
  LayoutGrid,
  Package,
  Settings2,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { MenuKey } from "@repo/contracts/menu";

export interface NavLeaf {
  label: string;
  href: string;
  /** RBAC/menu key shared with the API response contract. */
  menuKey: MenuKey;
}

export interface NavItem {
  label: string;
  href?: string;
  icon: LucideIcon;
  children?: NavLeaf[];
  menuKey: MenuKey;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/** Customer navigation for the currently implemented CRA workspace. */
export const NAV: NavSection[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutGrid,
        menuKey: "dashboard",
      },
      {
        label: "Management",
        href: "/management",
        icon: Settings2,
        menuKey: "management",
      },
      {
        label: "Organization",
        href: "/organization",
        icon: Building2,
        menuKey: "organization",
      },
      {
        label: "Products",
        href: "/products",
        icon: Package,
        menuKey: "products",
      },
    ],
  },
  {
    label: "Account & access",
    items: [
      {
        label: "Profile",
        icon: UserRound,
        menuKey: "profile",
        children: [
          {
            label: "Account",
            href: "/account",
            menuKey: "profile.account",
          },
          {
            label: "Security",
            href: "/security",
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
            href: "/roles",
            menuKey: "authorization.roles",
          },
          {
            label: "Permissions",
            href: "/permissions",
            menuKey: "authorization.permissions",
          },
        ],
      },
    ],
  },
];
