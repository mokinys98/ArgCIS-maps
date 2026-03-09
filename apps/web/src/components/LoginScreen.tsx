import type { FormEvent } from "react";
import { useState } from "react";

interface LoginScreenProps {
  error: string | null;
  onSubmit(email: string, password: string): Promise<void>;
}

export function LoginScreen({ error, onSubmit }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(email, password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-panel">
        <p className="eyebrow">ArgCIS Maps</p>
        <h1>Vidinis zemelapiu valdymo sluoksnis</h1>
        <p className="muted">
          Prisijunkite per Supabase Auth arba ijunkite demo rezima, jei dar
          nejungiate realios autentikacijos.
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            El. pastas
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="planner@argcis.local"
              required
            />
          </label>
          <label>
            Slaptazodis
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              required
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" disabled={submitting}>
            {submitting ? "Jungiamasi..." : "Prisijungti"}
          </button>
        </form>
      </div>
    </div>
  );
}
