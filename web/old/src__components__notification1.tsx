import { X } from "@mynaui/icons-react";

export default function Basic() {
  return (
    <div
      className="flex w-full items-center justify-between rounded bg-background px-4 py-3 font-medium shadow-sm ring-1 ring-border sm:w-96"
      aria-live="assertive"
    >
      <span className="truncate text-sm">Bookmark saved!</span>
      <div className="flex shrink-0 items-center gap-3 text-sm">
        <a href="#" className="text-blue-600">
          Undo
        </a>
        <p aria-hidden="true" className="select-none text-border">
          |
        </p>
        <a href="#">
          <X className="size-4 text-muted-foreground" stroke={2} />
        </a>
      </div>
    </div>
  );
}
