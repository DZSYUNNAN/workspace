import React from 'react';
import { useApp } from '../state';

export function Toasts(): React.ReactElement {
  const { toasts } = useApp();
  if (toasts.length === 0) return <></>;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
