import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Input } from "../input";
import { Form, FormErrorSummary, FormField, useZodForm } from "./form";

const schema = z.object({ email: z.email("Enter a valid email") });

function Example({
  onSubmit,
}: {
  onSubmit: (value: { email: string }) => void;
}) {
  const form = useZodForm(schema, { defaultValues: { email: "" } });
  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormErrorSummary form={form} />
      <FormField
        name="email"
        render={({ field, error, isTouched, isSubmitting }) => (
          <Input
            label="Email"
            error={error}
            data-touched={isTouched}
            disabled={isSubmitting}
            {...field}
          />
        )}
      />
      <button type="submit">Save</button>
    </Form>
  );
}

describe("form helpers", () => {
  it("blocks invalid data, summarizes errors, and submits parsed values", async () => {
    const onSubmit = vi.fn();
    render(<Example onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findAllByRole("alert")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          textContent: expect.stringContaining("Enter a valid email"),
        }),
      ]),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith(
      { email: "ada@example.com" },
      expect.anything(),
    );
  });

  it("requires FormField to be inside a form provider", () => {
    expect(() =>
      render(<FormField name={"email" as never} render={() => null} />),
    ).toThrow("<FormField> must be rendered inside <Form>.");
  });
});
