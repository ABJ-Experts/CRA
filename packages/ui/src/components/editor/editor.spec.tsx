import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chain = {
  focus: vi.fn(),
  toggleItalic: vi.fn(),
  toggleBold: vi.fn(),
  toggleUnderline: vi.fn(),
  setTextAlign: vi.fn(),
  toggleBlockquote: vi.fn(),
  toggleCode: vi.fn(),
  run: vi.fn(() => true),
};
for (const key of Object.keys(chain)) {
  if (key !== "run")
    (chain as Record<string, ReturnType<typeof vi.fn>>)[key]!.mockReturnValue(
      chain,
    );
}
const editor = {
  chain: vi.fn(() => chain),
  isActive: vi.fn((value: unknown) => value === "bold"),
  getHTML: vi.fn(() => "<p>Hello</p>"),
  commands: { setContent: vi.fn() },
  setEditable: vi.fn(),
};
let editorOptions: { onUpdate?: (args: { editor: typeof editor }) => void } =
  {};

vi.mock("@tiptap/react", () => ({
  useEditor: (options: typeof editorOptions) => {
    editorOptions = options;
    return editor;
  },
  EditorContent: ({ style }: { style: React.CSSProperties }) => (
    <div role="textbox" style={style} />
  ),
}));
vi.mock("@tiptap/starter-kit", () => ({
  default: { configure: vi.fn(() => "starter") },
}));
vi.mock("@tiptap/extension-text-align", () => ({
  default: { configure: vi.fn(() => "align") },
}));
vi.mock("@tiptap/extension-placeholder", () => ({
  default: { configure: vi.fn(() => "placeholder") },
}));

import { Editor } from "./editor";

describe("Editor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs formatting commands and submits current HTML", async () => {
    const onFormat = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Editor
        label="Message"
        helperText="Supports formatting"
        onFormat={onFormat}
        onSubmit={onSubmit}
        minLines={3}
      />,
    );
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(bold);
    expect(chain.toggleBold).toHaveBeenCalled();
    expect(onFormat).toHaveBeenCalledWith("bold");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith("<p>Hello</p>");
    expect(screen.getByRole("textbox")).toHaveStyle({ minHeight: "63px" });
  });

  it("emits updates and synchronizes controlled content without feedback", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Editor value="<p>External</p>" onValueChange={onValueChange} />,
    );
    expect(editor.commands.setContent).toHaveBeenCalledWith("<p>External</p>", {
      emitUpdate: false,
    });
    editorOptions.onUpdate?.({ editor });
    expect(onValueChange).toHaveBeenCalledWith("<p>Hello</p>");
    editor.getHTML.mockReturnValue("<p>Same</p>");
    rerender(<Editor value="<p>Same</p>" onValueChange={onValueChange} />);
  });

  it("supports disabled, error, button-submit, and minimal configurations", async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Editor
        disabled
        error="Required"
        helperText="Hint"
        submit="button"
        submitLabel="Post"
        submitBefore={<span>From Ada</span>}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.queryByText("Hint")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
    expect(editor.setEditable).toHaveBeenCalledWith(false);
    rerender(<Editor toolbar={false} tools={false} submit="none" />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
