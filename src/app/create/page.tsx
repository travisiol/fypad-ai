import type { Metadata } from "next";
import CreateLoader from "./CreateLoader";

export const metadata: Metadata = { title: "Create" };

/** /create: the same flow as the sidebar overlay, as a page (deep links, refresh, phones). */
export default function CreatePage() {
  return (
    <div className="flex min-h-[calc(100vh-110px)] items-start justify-center px-4 py-6 md:min-h-screen md:items-center md:py-10">
      <div className="modal w-full max-w-[920px] border" style={{ boxShadow: "none" }}>
        <CreateLoader />
      </div>
    </div>
  );
}
