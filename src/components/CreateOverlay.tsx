"use client";

import dynamic from "next/dynamic";
import { Modal } from "./Modal";
import { closeCreate, useCreate } from "./ui-store";

const CreateFlow = dynamic(() => import("./create/CreateFlow"), { ssr: false, loading: () => <div className="h-80" /> });

/** "Create influencer" from anywhere: the create flow as a modal over the current page. */
export function CreateOverlay() {
  const c = useCreate();
  return (
    <Modal open={c.open} onClose={closeCreate} width={940} closeOutside={false} testId="create-overlay">
      <CreateFlow key={`${c.influencerId ?? "new"}-${c.n}`} initialInfluencerId={c.influencerId} initialIdea={c.idea} onClose={closeCreate} />
    </Modal>
  );
}
