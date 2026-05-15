'use client';

import { useState } from 'react';
import { NewPlanModal } from './new-plan-modal';

export function NewPlanButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="btn btn--primary" onClick={() => setOpen(true)}>
        + New Plan
      </button>
      {open && <NewPlanModal onClose={() => setOpen(false)} />}
    </>
  );
}
