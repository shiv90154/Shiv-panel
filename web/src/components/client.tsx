"use client";

export function ConfirmButton({ message, children, className = "danger sm" }: { message: string; children: React.ReactNode; className?: string }) {
  return (
    <button className={className} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}

export function CopyButton({ text }: { text: string }) {
  return (
    <button type="button" className="sm" onClick={(e) => { navigator.clipboard.writeText(text); const b = e.currentTarget; b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); }}>
      Copy
    </button>
  );
}
