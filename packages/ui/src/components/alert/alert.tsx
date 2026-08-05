"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button, type ButtonProps } from "../button";

/**
 * Alert - Pencil frame `YsnGb`.
 *
 * A compact, centred confirmation dialog. Measured from the frame:
 *
 *   card       320 wide, radius 12, padding 24, gap 24, vertical, centred
 *   surface    #ffffff / #26282a  -> `elevated`
 *   title      18px Medium, centred, #1b1d1f / #ffffff        -> `h6` + `fg`
 *   body       14px Regular, centred, #727880 / #898f96 -> `subhead-regular`
 *              + `fg-muted`
 *   actions    full width, gap 10, centred, 40 tall
 *   cancel     outline / grey / md   (our Button, verbatim)
 *   confirm    fill / primary / md
 *
 * The frame's confirm button also carries the scrim-white-15 hairline, but
 * there it separates the label from a trailing arrow. With no icon the
 * divider would be a stray bar, so it is opt-in via the Button's own
 * `withDivider` + `endIcon` rather than defaulted on here.
 *
 * The three rows plus two 24px gaps and 24px padding sum to exactly the
 * frame's 184px height, which is how the gap was confirmed as uniform.
 *
 * The frame's `Grid / Slide Bar` child is a measurement overlay the designer
 * left on the canvas, not part of the component, so it is not reproduced.
 *
 * Built on Radix AlertDialog rather than Dialog because this pattern
 * *interrupts*: it traps focus, ignores outside clicks, and requires an
 * explicit choice. Radix supplies the focus trap, ESC handling, `role`,
 * `aria-modal` and the title/description associations.
 *
 * ```tsx
 * <Alert
 *   trigger={<Button tone="grey" variant="outline">Delete</Button>}
 *   title="Delete this project?"
 *   description="This cannot be undone."
 *   confirmLabel="Delete"
 *   onConfirm={() => remove(id)}
 * />
 * ```
 *
 * For full control over the body, use the parts instead:
 * `AlertRoot` / `AlertTrigger` / `AlertContent` / `AlertTitle` /
 * `AlertDescription` / `AlertActions` / `AlertCancel` / `AlertAction`.
 */

export const AlertRoot = AlertDialogPrimitive.Root;
export const AlertTrigger = AlertDialogPrimitive.Trigger;
export const AlertPortal = AlertDialogPrimitive.Portal;

export type AlertOverlayProps = ComponentProps<typeof AlertDialogPrimitive.Overlay>;

export function AlertOverlay({ className, ...props }: AlertOverlayProps) {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-scrim-black-50",
        "data-[state=open]:animate-backdrop-in",
        // No exit animation: Radix keeps the scroll lock mounted on the
        // overlay until the exit animation reports `animationend`, so if that
        // event never arrives the page is left locked behind an opaque,
        // click-swallowing scrim. See the same note on ModalOverlay.
        "data-[state=closed]:animate-none",
        "motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export type AlertContentProps = ComponentProps<typeof AlertDialogPrimitive.Content>;

export function AlertContent({ className, children, ...props }: AlertContentProps) {
  return (
    <AlertPortal>
      <AlertOverlay />
      {/*
        Centred by a flex wrapper, NOT by `top-1/2 left-1/2 -translate-1/2`.
        Tailwind v4 compiles `-translate-x-1/2` to the `translate` property,
        and `overlay-in` animates that same property - so the keyframe would
        overwrite the centring offset and the dialog would sit in the
        bottom-right quadrant for the whole enter animation, then snap.

        The wrapper also gives long content somewhere to scroll, and its
        padding keeps the card off the viewport edges on small screens.
        Swallowing backdrop clicks here costs nothing: an alert dialog is
        deliberately not dismissable by clicking outside.
      */}
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
        <AlertDialogPrimitive.Content
          className={cn(
            "flex w-80 max-w-full flex-col items-center gap-6",
            "rounded-xl bg-elevated p-6",
            "shadow-lg shadow-scrim-black-30",
            "outline-none",
            "data-[state=open]:animate-dialog-in",
            "data-[state=closed]:animate-dialog-out",
            "motion-reduce:animate-none",
            className,
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Content>
      </div>
    </AlertPortal>
  );
}

export type AlertTitleProps = ComponentProps<typeof AlertDialogPrimitive.Title>;

export function AlertTitle({ className, ...props }: AlertTitleProps) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("w-full text-center text-h6 text-fg", className)}
      {...props}
    />
  );
}

export type AlertDescriptionProps = ComponentProps<typeof AlertDialogPrimitive.Description>;

export function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("w-full text-center text-subhead-regular text-fg-muted", className)}
      {...props}
    />
  );
}

export function AlertActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center gap-2.5",
        // Stack on very narrow screens rather than letting two 40px buttons
        // squash their labels.
        "max-[380px]:flex-col max-[380px]:[&>*]:w-full",
        className,
      )}
      {...props}
    />
  );
}

export type AlertCancelProps = ButtonProps;

/** Closes the dialog. Radix returns focus to the trigger for us. */
export function AlertCancel({ variant = "outline", tone = "grey", ...props }: AlertCancelProps) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button variant={variant} tone={tone} {...props} />
    </AlertDialogPrimitive.Cancel>
  );
}

export type AlertActionProps = ButtonProps;

/** Confirms and closes. Pass `onClick` to run the action. */
export function AlertAction({ variant = "fill", tone = "primary", ...props }: AlertActionProps) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button variant={variant} tone={tone} {...props} />
    </AlertDialogPrimitive.Action>
  );
}

export interface AlertProps {
  /** Element that opens the alert. Omit when driving `open` yourself. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  title: ReactNode;
  /** Optional supporting line under the title. */
  description?: ReactNode;

  cancelLabel?: ReactNode;
  confirmLabel?: ReactNode;
  /** Hide the cancel button for acknowledge-only alerts. */
  showCancel?: boolean;

  /** Tone of the confirm button, from the Button's own set. */
  confirmTone?: ButtonProps["tone"];
  /** Blocks both buttons and spins the confirm one. */
  loading?: boolean;

  onConfirm?: () => void;
  onCancel?: () => void;

  className?: string;
}

export function Alert({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  showCancel = true,
  confirmTone = "primary",
  loading = false,
  onConfirm,
  onCancel,
  className,
}: AlertProps) {
  return (
    <AlertRoot open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertTrigger asChild>{trigger}</AlertTrigger> : null}
      <AlertContent className={className}>
        <AlertTitle>{title}</AlertTitle>
        {description ? <AlertDescription>{description}</AlertDescription> : null}
        <AlertActions>
          {showCancel ? (
            <AlertCancel disabled={loading} onClick={onCancel}>
              {cancelLabel}
            </AlertCancel>
          ) : null}
          <AlertAction tone={confirmTone} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </AlertAction>
        </AlertActions>
      </AlertContent>
    </AlertRoot>
  );
}
