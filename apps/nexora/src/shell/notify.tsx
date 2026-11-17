import { Toast, ToastBody, ToastTitle, useToastController } from "@fluentui/react-components";
import { useCallback } from "react";

export const TOASTER_ID = "nexora-toaster";

/** Small helper around Fluent toasts. */
export function useNotify() {
  const { dispatchToast } = useToastController(TOASTER_ID);
  return useCallback(
    (title: string, body?: string, intent: "success" | "error" | "info" | "warning" = "info") =>
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
          {body && <ToastBody>{body}</ToastBody>}
        </Toast>,
        { intent, timeout: intent === "error" ? 8000 : 3000 },
      ),
    [dispatchToast],
  );
}
