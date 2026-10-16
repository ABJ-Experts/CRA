import { cn } from "@repo/ui/cn";
import { SystemHealthScreen } from "../../../_features/system-health/system-health-screen";

export default function SystemHealthPage() {
  return (
    <div className={cn("px-6 py-6 lg:px-[30px]")}>
      <SystemHealthScreen />
    </div>
  );
}
