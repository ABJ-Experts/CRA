"use client";

import { Sidebar } from "../../_components/sidebar/sidebar";
import { APP_NAV } from "./app-nav";

/**
 * Client-side wrapper that binds the product navigation to the shared Sidebar.
 *
 * This indirection is load-bearing. AppLayout is a Server Component (it reads
 * the session cookie), and NavItem.icon is a Lucide component — a function.
 * Functions cannot cross the server-to-client boundary as props, so passing
 * APP_NAV down from the layout fails at render with "Functions cannot be passed
 * directly to Client Components". Importing it inside a client module keeps the
 * whole nav on the client side of the boundary, which is how the template's own
 * Sidebar gets NAV.
 */
export function AppSidebar() {
  return <Sidebar sections={APP_NAV} />;
}
