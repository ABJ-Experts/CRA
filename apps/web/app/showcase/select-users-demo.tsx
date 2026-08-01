"use client";

import { Input } from "@repo/ui/input";
import { SelectUsers, type SelectUsersOption } from "@repo/ui/select-users";
import { useState } from "react";

const USERS: SelectUsersOption[] = [
  { value: "wade", name: "Wade Warren", status: "online", description: "Engineering" },
  { value: "ronald", name: "Ronald Richards", status: "busy", description: "Design" },
  // No description: the frame's own single-line row, which measures 55.
  { value: "jenny", name: "Jenny Wilson" },
  { value: "jane", name: "Jane Cooper", status: "away", description: "Support" },
  { value: "jacob", name: "Jacob Jones", description: "Finance" },
  { value: "esther", name: "Esther Howard", description: "Marketing" },
  { value: "cameron", name: "Cameron Williamson", description: "Operations" },
  { value: "eleanor", name: "Eleanor Pena", disabled: true, description: "On leave" },
];

export function SelectUsersDemo() {
  const [user, setUser] = useState("wade");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <SelectUsers
          label="Label"
          required
          users={USERS}
          value={user}
          onValueChange={setUser}
          data-testid="su-controlled"
        />
        <SelectUsers label="Label" required users={USERS} data-testid="su-empty" />
        <SelectUsers
          label="Label"
          required
          users={USERS}
          error="Something Error Alert"
          data-testid="su-error"
        />
        <SelectUsers
          label="Label"
          users={USERS}
          defaultValue="jane"
          disabled
          data-testid="su-disabled"
        />
      </div>
      <span className="text-caption-2-regular text-fg-subtle" data-testid="su-value">
        assignee: {user}
      </span>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          Forms/Title (jK37E) is Input at size=lg: 400x56, padding 13 16, 20px
          Medium. No separate component - the trailing &quot;Note&quot; is the
          endIcon slot.
        </span>
        <div className="max-w-md">
          <Input
            size="lg"
            placeholder="Enter Title"
            aria-label="Title"
            endIcon={
              <span className="shrink-0 text-caption-1-medium text-fg-subtle">Note</span>
            }
            data-testid="title-lg"
          />
        </div>
      </div>
    </div>
  );
}
