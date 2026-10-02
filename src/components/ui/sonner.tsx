import { createPortal } from "react-dom";
import { Toaster as Sonner } from "sonner";
import { usePortalContainer } from "@/hooks/use-portal-container";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // Sonner renders in place, which is <body>: invisible behind an element in
  // fullscreen. Follow the fullscreen element there so an export's "done" or
  // "failed" still reaches the reader. See `usePortalContainer`.
  const container = usePortalContainer();
  const toaster = (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
  return container ? createPortal(toaster, container) : toaster;
};

export { Toaster };
