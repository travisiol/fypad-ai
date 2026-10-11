import { SparkIcon } from "./Icons";

/** FYPAD's empty state: a gradient sparkle disc, a title and one sentence. */
export function Empty({ title, text, children, testId }: { title: string; text: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center" data-testid={testId}>
      <span className="inline-flex size-14 items-center justify-center rounded-2xl text-white shadow-[0_10px_24px_-10px_rgba(123,97,255,0.8)]" style={{ background: "var(--grad)" }}>
        <SparkIcon size={26} />
      </span>
      <h2 className="display mt-4 text-[22px]">{title}</h2>
      <p className="muted mt-1.5 max-w-sm text-[15px]">{text}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
