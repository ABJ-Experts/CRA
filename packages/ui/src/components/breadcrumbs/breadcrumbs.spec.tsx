import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BreadcrumbItem, Breadcrumbs } from "./breadcrumbs";

const trail = [
  <BreadcrumbItem key="home" asChild>
    <a href="/">Home</a>
  </BreadcrumbItem>,
  <BreadcrumbItem key="team" asChild>
    <a href="/team">Team</a>
  </BreadcrumbItem>,
  <BreadcrumbItem key="members" asChild>
    <a href="/team/members">Members</a>
  </BreadcrumbItem>,
  <BreadcrumbItem key="ada" current>
    Ada
  </BreadcrumbItem>,
];

describe("Breadcrumbs", () => {
  it("marks the current item and keeps navigable ancestors", () => {
    render(<Breadcrumbs size="md">{trail}</Breadcrumbs>);
    expect(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByText("Ada")).toHaveAttribute("aria-current", "page");
  });

  it("collapses and expands a deep trail with an exact accessible count", async () => {
    render(<Breadcrumbs maxItems={3}>{trail}</Breadcrumbs>);
    expect(
      screen.queryByRole("link", { name: "Team" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Show 1 hidden breadcrumbs" }),
    );
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
  });

  it("renders disabled ancestors inert and accepts a custom separator", () => {
    render(
      <Breadcrumbs label="Location" size="sm" separator={<span>/</span>}>
        <BreadcrumbItem disabled asChild>
          Unavailable
        </BreadcrumbItem>
        <BreadcrumbItem current>Here</BreadcrumbItem>
      </Breadcrumbs>,
    );
    expect(screen.getByText("Unavailable")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("/")).toBeInTheDocument();
  });
});
