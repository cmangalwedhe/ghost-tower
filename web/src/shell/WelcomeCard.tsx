import { useState } from "react";

const KEY = "gt-welcome-dismissed";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Context for someone who opens the link without having seen the pitch. Only used on simulated data, never on stage. */
export function WelcomeCard() {
  const [open, setOpen] = useState(() => !wasDismissed());
  if (!open) return null;

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private window: it simply shows again next visit */
    }
  };

  return (
    <aside className="welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">What you're looking at</h2>
      <p>A simulated replay of Ghost Tower catching a fake cell tower driving through Richardson, TX.</p>
      <ol>
        <li>A car carrying a fake cell tower sends scam texts straight to nearby phones, so the phone company never sees them.</li>
        <li>Phones notice they lost their normal signal and then got the text. Each orange dot is one of those reports.</li>
        <li>Ghost Tower estimates where the car is, predicts its route and warns phones ahead of it.</li>
      </ol>
      <button type="button" className="welcome-close" onClick={dismiss}>Got it</button>
    </aside>
  );
}
