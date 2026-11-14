import { useState, type FormEvent } from "react";
import { towerArt } from "../shell/symbols";
import { useAuth } from "./AuthContext";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!signIn(user, pass)) setError(true);
  }

  return (
    <div className="login">
      <aside className="login-brand">
        <div>
          <p className="login-event">HackUTD 2026 · Zero Day</p>
          <span className="login-mark" dangerouslySetInnerHTML={{ __html: towerArt(150) }} />
        </div>
        <div className="login-brand-mid">
          <h1 className="login-word">Ghost <b>Tower</b></h1>
          <p className="login-kicker">Hunting fake cell towers from the phones they attack.</p>
        </div>
        <p className="login-foot">Scammers drive fake cell towers around to text people directly. Ghost Tower finds them, follows them and warns the phones ahead.</p>
      </aside>

      <main className="login-panel">
        <form className="login-form" onSubmit={onSubmit}>
          <h2 className="login-h2">Sign in</h2>
          <p className="login-lead">Watch the live map and see a fake tower get caught.</p>

          {error && (
            <p className="login-error" role="alert">
              That username or password didn’t match.
            </p>
          )}

          <label className="login-field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              autoFocus
              value={user}
              onChange={(e) => {
                setUser(e.target.value);
                setError(false);
              }}
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setError(false);
              }}
            />
          </label>

          <button type="submit" className="login-submit">
            Sign in
          </button>

          <p className="login-fine">Demo access for the team and judges.</p>
        </form>
      </main>
    </div>
  );
}
