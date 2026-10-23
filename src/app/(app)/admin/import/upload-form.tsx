"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/action";

export function UploadForm({
  action,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3 rounded border border-gray-200 bg-white p-4">
      <label className="block text-sm font-medium text-gray-800">
        Workbook file
        <input
          type="file"
          name="workbook"
          accept=".xlsm,.xlsx"
          required
          className="mt-1 block text-sm"
        />
      </label>
      <FormMessage state={state} />
      <SubmitButton pendingText="Reading the workbook…">Upload and check</SubmitButton>
    </form>
  );
}
