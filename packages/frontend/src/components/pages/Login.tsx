import { createSignal } from 'solid-js';
import { api, setTokens } from '../../api';

interface Props {
  onLogin: () => void;
}

export function Login(props: Props) {
  // Never pre-fill credentials — it advertises the default account.
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>(
        '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: username(),
            password: password(),
          }),
        },
      );
      setTokens(res.accessToken, res.refreshToken);
      props.onLogin();
    } catch (err) {
      const offline =
        err instanceof TypeError ||
        (err instanceof Error &&
          (err.message === 'Failed to fetch' || err.message.includes('fetch')));
      setError(
        offline
          ? 'Backend indisponible — attendez « Backend listening on port 3000 » puis réessayez.'
          : 'Identifiants invalides',
      );
    }
  }

  return (
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-icon">PW</div>
          <h1>Polywatch</h1>
          <p>Surveillance et copy trading Polymarket</p>
        </div>
        <form class="login-form" onSubmit={handleSubmit}>
          <div class="form-field">
            <label for="username">Utilisateur</label>
            <input
              id="username"
              class="input"
              type="text"
              placeholder="Utilisateur"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
            />
          </div>
          <div class="form-field">
            <label for="password">Mot de passe</label>
            <input
              id="password"
              class="input"
              type="password"
              placeholder="Mot de passe"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </div>
          {error() && <p class="login-error">{error()}</p>}
          <button class="btn btn-primary btn-block" type="submit">
            Connexion
          </button>
        </form>
      </div>
    </div>
  );
}
