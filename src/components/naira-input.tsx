"use client";

import { useState } from "react";
import { groupNairaTyping } from "@/lib/format";
import { inputClass } from "./form";

/** An amount in naira: a ₦ sign in the box and thousands separators added while typing. */
export function NairaInput({
  id,
  name,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(() => groupNairaTyping(defaultValue ?? ""));
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-gray-500"
      >
        ₦
      </span>
      <input
        id={id}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(ev) => {
          const input = ev.target;
          const next = groupNairaTyping(input.value);
          // Keep the caret after the same number of digits once commas move.
          const caret = input.selectionStart ?? input.value.length;
          const digitsBefore = input.value.slice(0, caret).replace(/[^\d.]/g, "").length;
          setValue(next);
          requestAnimationFrame(() => {
            let pos = 0;
            for (let seen = 0; pos < next.length && seen < digitsBefore; pos++) {
              if (/[\d.]/.test(next[pos]!)) seen++;
            }
            input.setSelectionRange(pos, pos);
          });
        }}
        className={`${inputClass} pl-6 tabular-nums`}
      />
    </div>
  );
}
