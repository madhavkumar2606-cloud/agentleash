/** Countersign mark: a pen stroke (the agent's request) and a second mark, the owner's countersignature. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      <rect width="36" height="36" rx="9" fill="#16150f" />
      <path
        d="M7.5 21.5c2.2-4.6 4.4-7 5.6-6.2 1.4.9-1.6 6.7-.2 7.2 1.3.5 3.3-4.9 4.6-4.4 1.1.4-.3 3.6.8 3.9.8.2 1.7-1.2 2.7-2.2"
        stroke="#f6f4ef"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.5 27h13" stroke="#f6f4ef" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M22.5 22.5l2.6 2.6 4.9-6.6" stroke="#4ea1ff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
