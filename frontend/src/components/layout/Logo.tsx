import { Link } from "react-router-dom";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="url(#ng-g)" />
      <defs>
        <linearGradient id="ng-g" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="#0e7490" />
          <stop offset="1" stopColor="#4c1d95" />
        </linearGradient>
      </defs>
      <path
        d="M10 22V11.5a1.5 1.5 0 0 1 3 0V17m0-7a1.5 1.5 0 0 1 3 0v7m0-6a1.5 1.5 0 0 1 3 0v6m0-4a1.5 1.5 0 0 1 3 0v5.5A6.5 6.5 0 0 1 15.5 25H15a5 5 0 0 1-5-5"
        fill="none"
        stroke="#e0fbff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11.5" cy="11" r="1.3" fill="#67e8f9" />
      <circle cx="14.5" cy="9.5" r="1.3" fill="#67e8f9" />
    </svg>
  );
}

export function Logo({ to = "/dashboard" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-lg" aria-label="NeuroGrip home">
      <LogoMark />
      <div className="leading-tight">
        <div className="font-display text-[15px] font-bold tracking-tight text-ink">NeuroGrip</div>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">Prosthetic Intelligence</div>
      </div>
    </Link>
  );
}
