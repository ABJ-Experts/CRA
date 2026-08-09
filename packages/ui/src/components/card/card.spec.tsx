import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

describe("Card", () => {
  it("publishes visual context and renders its semantic parts", () => {
    render(
      <Card variant="primary" size="sm" data-testid="card">
        <CardHeader action={<button type="button">Menu</button>}>
          <CardTitle>Revenue</CardTitle>
          <CardDescription>This month</CardDescription>
        </CardHeader>
        <CardBody>£20</CardBody>
        <CardFooter>Updated now</CardFooter>
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveAttribute("data-card-variant", "primary");
    expect(card).toHaveAttribute("data-card-size", "sm");
    expect(screen.getByRole("heading", { name: "Revenue" })).toHaveClass(
      "text-headline-semibold",
    );
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("renders an interactive card as its child", () => {
    render(
      <Card asChild interactive variant="filled">
        <a href="/details">Details</a>
      </Card>,
    );
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute(
      "href",
      "/details",
    );
  });

  it.each(["canvas", "surface"] as const)(
    "adds a non-interactive %s fade",
    (fadeOn) => {
      const { container } = render(
        <CardBody scrollable fadeOn={fadeOn}>
          Rows
        </CardBody>,
      );
      expect(container.querySelector('[aria-hidden="true"]')).toHaveClass(
        fadeOn === "surface" ? "bg-grad-fade-surface" : "bg-grad-fade-canvas",
        "pointer-events-none",
      );
    },
  );

  it("uses a plain body when scrolling is disabled", () => {
    const { container } = render(<CardBody className="body">Rows</CardBody>);
    expect(container.firstElementChild).toHaveClass("body", "min-w-0");
    expect(
      container.querySelector('[aria-hidden="true"]'),
    ).not.toBeInTheDocument();
  });
});
