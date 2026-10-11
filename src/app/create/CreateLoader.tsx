"use client";

import dynamic from "next/dynamic";

const CreateFlow = dynamic(() => import("@/components/create/CreateFlow"), { ssr: false, loading: () => <div className="h-80" /> });

export default function CreateLoader() {
  return <CreateFlow />;
}
