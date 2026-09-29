"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePortalContainer } from "@/hooks/use-portal-container";

/**
 * The one Modal for the whole app. A props-driven wrapper around Radix Dialog
 * that always renders at the top of the stacking order (--z-modal), so a modal
 * comes over everything — nav, sheets, popovers, viewers. Reuse this for every
 * centered dialog instead of hand-rolling `fixed inset-0` overlays; pass only
 * the pieces you need (title/description/footer are all optional). For a
 * chromeless surface (image viewer, fullscreen embed) set `bare`.
 */

type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "full";

const sizeClass: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-4xl",
  full: "max-w-[95vw]",
};

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Optional leading glyph shown beside the title. */
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  /** Vertical anchor: centered (default) or pinned near the top (palettes). */
  align?: "center" | "top";
  showClose?: boolean;
  /** Drop all built-in chrome (header/padding); render children raw. */
  bare?: boolean;
  /** Extra classes for the content surface. */
  className?: string;
  /** Extra classes for the scrollable body wrapper. */
  bodyClassName?: string;
  children?: React.ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  footer,
  size = "lg",
  align = "center",
  showClose = true,
  bare = false,
  className,
  bodyClassName,
  children,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={usePortalContainer()}>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-(--z-modal) bg-foreground/25 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <div
          className={cn(
            "fixed inset-0 z-(--z-modal) flex justify-center p-4 sm:p-6",
            align === "center" ? "items-center" : "items-start pt-[10vh]",
          )}
        >
          <DialogPrimitive.Content
            className={cn(
              "flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150",
              sizeClass[size],
              className,
            )}
          >
            {/* Radix requires an accessible title; hide it when none is shown. */}
            {title ? null : (
              <DialogPrimitive.Title className="sr-only">Dialog</DialogPrimitive.Title>
            )}

            {bare ? (
              children
            ) : (
              <>
                {(title || showClose) && (
                  <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {icon && <span className="shrink-0 text-primary">{icon}</span>}
                      <div className="min-w-0">
                        {title && (
                          <DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">
                            {title}
                          </DialogPrimitive.Title>
                        )}
                        {description && (
                          <DialogPrimitive.Description className="text-xs text-muted-foreground">
                            {description}
                          </DialogPrimitive.Description>
                        )}
                      </div>
                    </div>
                    {showClose && (
                      <DialogPrimitive.Close
                        aria-label="Close"
                        className="-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="h-4 w-4" />
                      </DialogPrimitive.Close>
                    )}
                  </div>
                )}

                <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>
                  {children}
                </div>

                {footer && (
                  <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
                    {footer}
                  </div>
                )}
              </>
            )}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const ModalClose = DialogPrimitive.Close;
