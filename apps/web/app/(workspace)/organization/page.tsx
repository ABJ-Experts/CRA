import { Suspense } from "react";
import { cn } from "@repo/ui/cn";
import { OrganizationAdministrationContent } from "./organization-administration-content";

export default function OrganizationAdministrationPage() {
  return (
    <Suspense
      fallback={
        <p
          role="status"
          className={cn("p-6 text-subhead-regular text-fg-muted")}
        >
          Loading organization administration…
        </p>
      }
    >
      <OrganizationAdministrationContent />
    </Suspense>
  );
}
