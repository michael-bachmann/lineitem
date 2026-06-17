import { Chip } from "@lineitem/ui";

type Props =
  | { variant: "live" | "planned"; name: string }
  | { variant: "request"; name: string; onClick: () => void };

const ROW = "flex items-center gap-3 rounded-control px-[18px] py-4 text-[16px]";

/** A retailer status row, or the dashed "Request a retailer" CTA. */
export default function RetailerRow(props: Props) {
  if (props.variant === "request") {
    return (
      <button
        type="button"
        onClick={props.onClick}
        className={`${ROW} group border border-dashed border-line-strong bg-transparent text-left font-semibold text-link transition-colors hover:border-link hover:bg-surface`}
      >
        <span className="mr-auto">{props.name}</span>
        <span aria-hidden className="transition-transform group-hover:translate-x-[3px]">
          →
        </span>
      </button>
    );
  }

  const planned = props.variant === "planned";
  return (
    <div className={`${ROW} border border-line bg-surface shadow-card`}>
      <span className={`mr-auto font-semibold ${planned ? "text-muted" : "text-text"}`}>
        {props.name}
      </span>
      {planned ? (
        <Chip tone="neutral">Planned</Chip>
      ) : (
        <Chip tone="ok" dot>
          Live
        </Chip>
      )}
    </div>
  );
}
