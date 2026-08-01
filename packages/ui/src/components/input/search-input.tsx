"use client";

import { Search, X } from "lucide-react";
import {
  forwardRef,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import { inputControlVariants } from "./input.variants";

/**
 * SearchInput - Pencil frame `mBlqZ` ("Forms/Search").
 *
 * Not a variant of Input: the shape genuinely differs. Search is a pill on a
 * filled surface with no resting border, where Input is a 12-radius field on
 * the canvas with a 1px border.
 *
 *   box        400x40, radius 24, padding 10 12 9 12, gap 12
 *   surface    #f5f5f5 / #26282a -> `surface`, in every state
 *   default    no stroke
 *   hover      2px #ebecff / #232445 -> `accent-subtle`
 *   typing     1px #595fe5 -> `active-500`
 *   active     no stroke, value in `fg`
 *   error      1px #e5646c -> `danger`
 *
 * Radius 24 on a 40px box is past the half-height, so `rounded-full` is the
 * identical shape and stays correct if the field is ever made taller.
 *
 * Strokes are inset rings for the same reason as Input: swapping a real
 * border between 1px and 2px on hover would shift the content by a pixel.
 *
 * ```tsx
 * <SearchInput value={q} onValueChange={setQ} clearable />
 * ```
 */

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  /** Convenience over `onChange`, which is also still called. */
  onValueChange?: (value: string) => void;
  /** Show a clear button once there is a value. */
  clearable?: boolean;
  clearLabel?: string;
  /** Called when the field is cleared, after the value is emptied. */
  onClear?: () => void;
  /** Any truthy value switches the ring to `danger`. */
  error?: boolean;
  /** Replace the leading magnifier, or pass `null` to drop it. */
  icon?: ReactNode;
  /** Trailing slot, e.g. a keyboard shortcut hint. Sits before the clear button. */
  endAdornment?: ReactNode;
  wrapperClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      onValueChange,
      clearable = false,
      clearLabel = "Clear search",
      onClear,
      error = false,
      icon,
      endAdornment,
      placeholder = "Search",
      className,
      wrapperClassName,
      value,
      defaultValue,
      disabled,
      onChange,
      ...props
    },
    ref
  ) {
    // Mirrors the value so `clearable` works uncontrolled too, without
    // forcing the caller into controlled mode just to get a clear button.
    //
    // The <input> is ALWAYS driven by `current`, never by `defaultValue`.
    // Rendering it uncontrolled and tracking a separate copy looks equivalent
    // but is not: clearing would empty the copy - hiding the clear button -
    // while the DOM value stayed put, so the text visibly refused to go away.
    const [internal, setInternal] = useState(String(defaultValue ?? ""));
    const isControlled = value !== undefined;
    const current = isControlled ? String(value) : internal;
    const hasValue = current.length > 0;

    const innerRef = useRef<HTMLInputElement>(null);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setInternal(e.target.value);
      onChange?.(e);
      onValueChange?.(e.target.value);
    };

    const clear = () => {
      if (!isControlled) setInternal("");
      onValueChange?.("");
      onClear?.();
      // Clearing is a refinement of the search, not the end of it: keep the
      // caret where the user can carry on typing.
      innerRef.current?.focus();
    };

    return (
      <div
        className={cn(
          "relative flex w-full items-center gap-3",
          "h-10 rounded-full bg-surface px-3",
          "transition-[box-shadow] duration-150 ease-out motion-reduce:transition-none",
          "[&_svg]:size-4 [&_svg]:shrink-0",
          disabled
            ? "cursor-not-allowed opacity-60"
            : error
              ? [
                  "inset-ring-1 inset-ring-danger",
                  "hover:inset-ring-2 hover:inset-ring-danger",
                  "focus-within:inset-ring-1 focus-within:hover:inset-ring-1",
                ].join(" ")
              : [
                  // No resting ring: the frame's Default and Active states
                  // both draw the pill with no stroke at all.
                  "hover:inset-ring-2 hover:inset-ring-accent-subtle",
                  "focus-within:inset-ring-1 focus-within:inset-ring-active-500",
                  "focus-within:hover:inset-ring-1 focus-within:hover:inset-ring-active-500",
                ].join(" "),
          wrapperClassName
        )}
      >
        {icon === undefined ? (
          <Search aria-hidden="true" className="text-fg" strokeWidth={1.5} />
        ) : (
          icon
        )}

        <input
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="search"
          placeholder={placeholder}
          disabled={disabled}
          value={current}
          onChange={handleChange}
          className={cn(
            inputControlVariants({ size: "md" }),
            // Safari paints its own clear affordance on type=search, which
            // would sit alongside ours.
            "[&::-webkit-search-cancel-button]:appearance-none",
            className
          )}
          {...props}
        />

        {endAdornment}

        {clearable && hasValue && !disabled ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={clear}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full p-0.5",
              "text-fg-muted transition-colors duration-150 motion-reduce:transition-none",
              "hover:bg-elevated-hover hover:text-fg",
              "outline-none focus-visible:ring-2 focus-visible:ring-active-500"
            )}
          >
            <X aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
    );
  }
);
