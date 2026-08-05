"use client";

import { Eye, EyeOff, Lock } from "lucide-react";
import { forwardRef, useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Input, type InputProps } from "./input";

/**
 * PasswordInput - Pencil frame `nnD8v` ("Forms / Password").
 *
 * The frame's seven states (Default, Hover, Typing, Active Hide, Active Show,
 * Error, Disabled) are the Input's states plus a reveal toggle, and every one
 * resolves to chrome Input already renders:
 *
 *   hover     2px #ebecff  -> `accent-subtle`
 *   typing    1px #595fe5  -> `active-500`
 *   error     1px #e5646c  -> `danger`, message at 10px
 *   disabled  #f5f5f5 / #26282a -> `surface`, no border
 *
 * So this is a composition, not a second implementation: a bold lock at the
 * start, an eye / eye-slash toggle at the end. `Active Hide` and `Active Show`
 * are the two toggle positions.
 *
 * ```tsx
 * <PasswordInput label="Password" required />
 * ```
 */

export interface PasswordInputProps extends Omit<InputProps, "type" | "startIcon" | "endIcon"> {
  /** Replace the leading lock, or pass `null` to drop it. */
  startIcon?: ReactNode;
  /** Hide the reveal toggle, for fields that must never be shown. */
  revealable?: boolean;
  /**
   * Accessible names for the toggle's two positions. Named explicitly so they
   * do not read as variants of Input's own `hideLabel`, which is about the
   * field's visible label, not this button.
   */
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
  /** Uncontrolled initial visibility. */
  defaultVisible?: boolean;
  /** Controlled visibility. Pair with `onVisibleChange`. */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      startIcon,
      revealable = true,
      showPasswordLabel = "Show password",
      hidePasswordLabel = "Hide password",
      defaultVisible = false,
      visible: controlledVisible,
      onVisibleChange,
      placeholder = "Enter Password",
      disabled,
      id,
      ...props
    },
    ref,
  ) {
    const [uncontrolled, setUncontrolled] = useState(defaultVisible);
    const isControlled = controlledVisible !== undefined;
    const visible = isControlled ? controlledVisible : uncontrolled;
    const autoId = useId();
    // A caller-supplied id must win, or `aria-controls` would point at an
    // element that does not exist.
    const fieldId = id ?? autoId;

    const toggle = () => {
      const next = !visible;
      if (!isControlled) setUncontrolled(next);
      onVisibleChange?.(next);
    };

    return (
      <Input
        ref={ref}
        // `type` flips between password and text. Autocomplete stays
        // "current-password" either way so managers keep recognising it.
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        disabled={disabled}
        startIcon={startIcon === undefined ? <Lock /> : startIcon}
        endIcon={
          revealable ? (
            <button
              type="button"
              // Not a label swap on one control: the accessible name changes
              // with the state so a screen reader announces what the press
              // will do, and aria-pressed reports where it currently is.
              aria-label={visible ? hidePasswordLabel : showPasswordLabel}
              aria-pressed={visible}
              aria-controls={fieldId}
              disabled={disabled}
              onClick={toggle}
              // Keeps the field's focus ring from flashing as the pointer
              // lands on the toggle; the click still fires.
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                "flex shrink-0 items-center justify-center rounded",
                "text-fg-muted transition-colors duration-150 motion-reduce:transition-none",
                "hover:text-fg",
                "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
                "disabled:cursor-not-allowed disabled:hover:text-fg-muted",
              )}
            >
              {visible ? (
                <Eye aria-hidden="true" className="size-4" strokeWidth={1.5} />
              ) : (
                <EyeOff aria-hidden="true" className="size-4" strokeWidth={1.5} />
              )}
            </button>
          ) : undefined
        }
        id={fieldId}
        {...props}
      />
    );
  },
);
