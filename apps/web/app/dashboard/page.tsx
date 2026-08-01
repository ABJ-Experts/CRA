import { BreadcrumbItem, Breadcrumbs } from "@repo/ui/breadcrumbs";
import { Button } from "@repo/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import { Tag } from "@repo/ui/tag";
import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-lg:pt-20">
      <Breadcrumbs>
        <BreadcrumbItem asChild>
          <Link href="/dashboard">Dashboard</Link>
        </BreadcrumbItem>
        <BreadcrumbItem current>E-commerce</BreadcrumbItem>
      </Breadcrumbs>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h4 text-fg">E-commerce</h1>
          <p className="text-subhead-regular text-fg-muted">
            The sidebar is transcribed from Pencil frame ty4xx. Collapse it with the
            control next to the logo.
          </p>
        </div>
        <Button asChild variant="outline" tone="grey">
          <Link href="/showcase">Component showcase</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            { label: "Revenue", value: "$48,290", delta: "+8.2%" },
            { label: "Orders", value: "1,284", delta: "+3.1%" },
            { label: "Customers", value: "9,431", delta: "+11.7%" },
            { label: "Refunds", value: "42", delta: "-2.4%" },
          ] as const
        ).map(({ label, value, delta }) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              <CardDescription>Last 30 days</CardDescription>
            </CardHeader>
            <CardBody>
              <span className="text-h4 text-fg">{value}</span>
            </CardBody>
            <Tag variant="dot" tone={delta.startsWith("-") ? "red" : "green"}>
              {delta} vs last month
            </Tag>
          </Card>
        ))}
      </div>
    </div>
  );
}
