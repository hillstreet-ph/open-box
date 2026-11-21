import * as React from "react";

interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function Input(
  { className, ref, ...props }: InputProps,
) {
  return (
    <input
      className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className || ""}`}
      ref={ref}
      {...props}
    />
  );
}
