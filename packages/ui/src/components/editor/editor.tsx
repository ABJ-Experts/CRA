"use client";

import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Hash,
  Italic,
  Link,
  Mic,
  Plus,
  Quote,
  Send,
  Smile,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Editor - Pencil frames `sghh7`, `eGSmU`, `eOLYP` ("Forms/Editor #1-#3").
 *
 * The three frames are one shell in three configurations, not three
 * components. Shared chrome, measured:
 *
 *   box       600 wide, radius 12, padding 12, gap 16, vertical
 *             #f5f5f5 / #26282a -> `surface`
 *   default   no stroke
 *   hover     2px #ebecff / #232445 -> `accent-subtle`
 *   typing    1px #595fe5 -> `active-500`
 *   error     1px #e5646c -> `danger`
 *   format    16px icons, gap 12, 4px `border-strong` dot separators
 *   text      14px Regular, placeholder `fg-subtle`
 *   tools     add / mic / emoji / link / hashtag, 16px, gap 12
 *
 * What differs is only the top toolbar and the submit affordance:
 *
 *   #1  toolbar + a bare 16px send glyph
 *   #2  no toolbar + a filled primary button
 *   #3  toolbar + a "from" selector beside the button
 *
 * so they are `toolbar` and `submit` here.
 *
 * Rich text is TipTap (ProseMirror). Every button in the frame's toolbar is
 * a real command against the document, including the four alignment ones,
 * and each reports its own active state so the icon lights up when the caret
 * sits inside matching content.
 *
 * StarterKit v3 already bundles Underline and Link, so only TextAlign and
 * Placeholder are added - registering Underline again would collide on the
 * extension name.
 */

export type EditorCommand =
  | "bold"
  | "italic"
  | "underline"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-justify"
  | "quote"
  | "code";

interface FormatButton {
  command: EditorCommand;
  icon: LucideIcon;
  label: string;
  run: (e: TiptapEditor) => void;
  isActive: (e: TiptapEditor) => boolean;
}

const FORMAT_GROUPS: FormatButton[][] = [
  [
    {
      command: "italic",
      icon: Italic,
      label: "Italic",
      run: (e) => e.chain().focus().toggleItalic().run(),
      isActive: (e) => e.isActive("italic"),
    },
    {
      command: "bold",
      icon: Bold,
      label: "Bold",
      run: (e) => e.chain().focus().toggleBold().run(),
      isActive: (e) => e.isActive("bold"),
    },
    {
      command: "underline",
      icon: Underline,
      label: "Underline",
      run: (e) => e.chain().focus().toggleUnderline().run(),
      isActive: (e) => e.isActive("underline"),
    },
  ],
  [
    {
      command: "align-left",
      icon: AlignLeft,
      label: "Align left",
      run: (e) => e.chain().focus().setTextAlign("left").run(),
      isActive: (e) => e.isActive({ textAlign: "left" }),
    },
    {
      command: "align-center",
      icon: AlignCenter,
      label: "Align centre",
      run: (e) => e.chain().focus().setTextAlign("center").run(),
      isActive: (e) => e.isActive({ textAlign: "center" }),
    },
    {
      command: "align-right",
      icon: AlignRight,
      label: "Align right",
      run: (e) => e.chain().focus().setTextAlign("right").run(),
      isActive: (e) => e.isActive({ textAlign: "right" }),
    },
    {
      command: "align-justify",
      icon: AlignJustify,
      label: "Justify",
      run: (e) => e.chain().focus().setTextAlign("justify").run(),
      isActive: (e) => e.isActive({ textAlign: "justify" }),
    },
  ],
  [
    {
      command: "quote",
      icon: Quote,
      label: "Quote",
      run: (e) => e.chain().focus().toggleBlockquote().run(),
      isActive: (e) => e.isActive("blockquote"),
    },
    {
      command: "code",
      icon: Code,
      label: "Code",
      run: (e) => e.chain().focus().toggleCode().run(),
      isActive: (e) => e.isActive("code"),
    },
  ],
];

const TOOLS: { key: string; icon: LucideIcon; label: string }[] = [
  { key: "attach", icon: Plus, label: "Add attachment" },
  { key: "voice", icon: Mic, label: "Record voice note" },
  { key: "emoji", icon: Smile, label: "Insert emoji" },
  { key: "link", icon: Link, label: "Insert link" },
  { key: "tag", icon: Hash, label: "Add a tag" },
];

function IconButton({
  icon: Icon,
  label,
  active = false,
  pressable = false,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  pressable?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Toolbar buttons are toggles, so their state is announced. The tools
      // row are plain actions and get no aria-pressed.
      aria-pressed={pressable ? active : undefined}
      disabled={disabled}
      // preventDefault keeps the caret and selection alive: without it the
      // click blurs the editor first and the command applies to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center",
        "transition-colors duration-150 motion-reduce:transition-none",
        active ? "text-active-500" : "text-fg hover:text-active-500",
        "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg",
        "[&_svg]:size-4"
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.5} />
    </button>
  );
}

export interface EditorProps {
  /** Controlled HTML. Pair with `onValueChange`. */
  value?: string;
  /** Uncontrolled initial HTML. */
  defaultValue?: string;
  /** Fires with the document's HTML on every change. */
  onValueChange?: (html: string) => void;

  label?: ReactNode;
  required?: boolean;
  helperText?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;

  /** The format row. Frames #1 and #3 have it, #2 does not. */
  toolbar?: boolean;
  /** Bottom-left quick actions. Pass `false` to drop the row entirely. */
  tools?: boolean;
  /** `icon` is frame #1, `button` is frame #2. */
  submit?: "icon" | "button" | "none";
  submitLabel?: string;
  /** Receives the document's HTML. */
  onSubmit?: (html: string) => void;
  /** Extra content beside the submit control - frame #3's "from" selector. */
  submitBefore?: ReactNode;

  /** Called after every toolbar command runs. */
  onFormat?: (command: EditorCommand) => void;

  placeholder?: string;
  /** Minimum height of the writing area, in the design's 14px line units. */
  minLines?: number;

  className?: string;
  wrapperClassName?: string;
  "data-testid"?: string;
}

export function Editor({
  value,
  defaultValue,
  onValueChange,
  label,
  required = false,
  helperText,
  error,
  disabled = false,
  toolbar = true,
  tools = true,
  submit = "icon",
  submitLabel = "Send",
  onSubmit,
  submitBefore,
  onFormat,
  placeholder = "Placeholder",
  minLines = 2,
  className,
  wrapperClassName,
  ...rest
}: EditorProps) {
  const autoId = useId();
  const fieldId = `editor-${autoId}`;
  const errorId = `${fieldId}-error`;
  const helperId = `${fieldId}-helper`;

  const hasError = Boolean(error);

  const describedBy =
    [hasError ? errorId : null, helperText && !hasError ? helperId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const editor = useEditor({
    // Required under SSR: without it TipTap renders on the server and the
    // client immediately produces a different tree, which React reports as a
    // hydration mismatch.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // The frame has no heading or list controls, so those nodes are not
        // reachable from the UI. Left enabled anyway because paste and the
        // markdown input rules still produce them, and silently dropping
        // pasted structure is worse than rendering it.
        horizontalRule: false,
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? defaultValue ?? "",
    editorProps: {
      attributes: {
        id: fieldId,
        role: "textbox",
        "aria-multiline": "true",
        ...(label ? { "aria-labelledby": `${fieldId}-label` } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(hasError ? { "aria-invalid": "true" } : {}),
        class: cn(
          "outline-none",
          "text-subhead-regular text-fg",
          // ProseMirror renders real block nodes, so they need real styles.
          "[&_p]:min-h-[21px]",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3",
          "[&_code]:rounded [&_code]:bg-elevated-hover [&_code]:px-1 [&_code]:py-0.5",
          "[&_code]:text-caption-1-regular",
          "[&_pre]:rounded-lg [&_pre]:bg-elevated-hover [&_pre]:p-3",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_a]:text-active-500 [&_a]:underline",
          // Placeholder: the extension marks the first empty node, and this
          // draws the design's 14px `fg-subtle` prompt into it.
          "[&_p.is-editor-empty:first-child::before]:pointer-events-none",
          "[&_p.is-editor-empty:first-child::before]:float-left",
          "[&_p.is-editor-empty:first-child::before]:h-0",
          "[&_p.is-editor-empty:first-child::before]:text-fg-subtle",
          "[&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
        ),
      },
    },
    onUpdate: ({ editor: e }) => onValueChange?.(e.getHTML()),
  });

  // Controlled mode: push external changes in, but only when they differ, or
  // every keystroke would round-trip through setContent and reset the caret.
  useEffect(() => {
    if (!editor || value === undefined) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const runCommand = (b: FormatButton) => {
    if (!editor) return;
    b.run(editor);
    onFormat?.(b.command);
  };

  return (
    <div className={cn("flex w-full flex-col gap-1", wrapperClassName)} {...rest}>
      {label ? (
        <label
          id={`${fieldId}-label`}
          htmlFor={fieldId}
          className={cn(
            "flex items-center gap-0.5 text-caption-1-semibold",
            disabled ? "text-fg-subtle" : "text-fg-muted"
          )}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className={disabled ? "text-fg-subtle" : "text-danger"}>
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <div
        className={cn(
          "flex w-full flex-col gap-4 rounded-xl bg-surface p-3",
          "transition-[box-shadow] duration-150 ease-out motion-reduce:transition-none",
          disabled
            ? "cursor-not-allowed opacity-60"
            : hasError
              ? [
                  "inset-ring-1 inset-ring-danger",
                  "hover:inset-ring-2 hover:inset-ring-danger",
                  "focus-within:inset-ring-1 focus-within:hover:inset-ring-1",
                ].join(" ")
              : [
                  // The frame's Default draws no stroke at all.
                  "hover:inset-ring-2 hover:inset-ring-accent-subtle",
                  "focus-within:inset-ring-1 focus-within:inset-ring-active-500",
                  "focus-within:hover:inset-ring-1 focus-within:hover:inset-ring-active-500",
                ].join(" "),
          className
        )}
      >
        {toolbar ? (
          <div
            role="toolbar"
            aria-label="Formatting"
            aria-controls={fieldId}
            className="flex items-center gap-3"
          >
            {FORMAT_GROUPS.map((group, gi) => (
              <div key={gi} className="flex items-center gap-3">
                {gi > 0 ? (
                  <span
                    aria-hidden="true"
                    className="size-1 shrink-0 rounded-full bg-border-strong"
                  />
                ) : null}
                {group.map((b) => (
                  <IconButton
                    key={b.command}
                    icon={b.icon}
                    label={b.label}
                    pressable
                    active={editor ? b.isActive(editor) : false}
                    disabled={disabled}
                    onClick={() => runCommand(b)}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : null}

        <EditorContent
          editor={editor}
          style={{ minHeight: `${minLines * 21}px` }}
          className="w-full"
        />

        {tools || submit !== "none" || submitBefore ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {tools
                ? TOOLS.map((t) => (
                    <IconButton
                      key={t.key}
                      icon={t.icon}
                      label={t.label}
                      disabled={disabled}
                    />
                  ))
                : null}
            </div>

            <div className="flex shrink-0 items-center gap-4">
              {submitBefore}
              {submit === "icon" ? (
                <IconButton
                  icon={Send}
                  label={submitLabel}
                  disabled={disabled}
                  onClick={() => onSubmit?.(editor?.getHTML() ?? "")}
                />
              ) : null}
              {submit === "button" ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSubmit?.(editor?.getHTML() ?? "")}
                  className={cn(
                    "inline-flex h-10 shrink-0 items-center justify-center gap-2",
                    "rounded-xl bg-active-500 px-4 pt-[10px] pb-[9px]",
                    "text-subhead-semibold text-white",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    "hover:bg-active-600",
                    "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
                    "disabled:cursor-not-allowed disabled:opacity-60"
                  )}
                >
                  {submitLabel}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {hasError ? (
        <p id={errorId} role="alert" className="text-caption-2-regular text-danger">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-caption-2-regular text-fg-subtle">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
