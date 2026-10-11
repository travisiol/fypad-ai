import Link from "next/link";
import { Empty } from "@/components/Empty";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[600px] px-4 py-16">
      <div className="card">
        <Empty title="Nothing here" text="This influencer or post doesn't exist, or it was removed.">
          <Link href="/" className="btn btn-primary">
            Back to FYPAD
          </Link>
        </Empty>
      </div>
    </div>
  );
}
