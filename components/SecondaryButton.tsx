import type { ButtonHTMLAttributes } from "react";

/** Full-width gray button with the project's standard secondary styling.
 *  Use for non-destructive actions; pair with a dedicated primary or red
 *  variant for affirmative or destructive ones. */
export default function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  const base =
    "w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed";
  return <button {...rest} className={className ? `${base} ${className}` : base} />;
}
