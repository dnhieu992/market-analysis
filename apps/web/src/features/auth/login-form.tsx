'use client';

import { startTransition, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createApiClient } from '@web/shared/api/client';
import type { LoginStepResponse, TotpSetup } from '@web/shared/api/types';

const apiClient = createApiClient();

const MIN_PASSWORD_LENGTH = 10;

/**
 * Screens of the login state machine. The API decides which one comes next;
 * `backup-codes` is client-only — shown once right after 2FA is turned on.
 */
type Screen =
  | { kind: 'password' }
  | { kind: 'change-password'; challenge: string }
  | { kind: 'enroll-totp'; challenge: string }
  | { kind: 'totp'; challenge: string }
  | { kind: 'backup-codes'; codes: string[] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Có lỗi xảy ra, thử lại';
}

/** The API's "challenge expired" answer sends the user back to the password screen. */
function isExpired(message: string): boolean {
  return message.includes('hết hạn');
}

export function LoginForm() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function enterApp() {
    startTransition(() => {
      router.replace('/');
      router.refresh();
    });
  }

  function advance(result: LoginStepResponse) {
    setCode('');
    setError(null);
    if (result.step === 'done') {
      if (result.backupCodes?.length) {
        setScreen({ kind: 'backup-codes', codes: result.backupCodes });
        setIsSubmitting(false);
        return;
      }
      enterApp();
      return;
    }
    setScreen({ kind: result.step, challenge: result.challenge });
    setIsSubmitting(false);
  }

  async function run(action: () => Promise<LoginStepResponse>) {
    setIsSubmitting(true);
    setError(null);
    try {
      advance(await action());
    } catch (err) {
      const message = errorText(err);
      if (isExpired(message)) {
        setScreen({ kind: 'password' });
        setPassword('');
        setSetup(null);
      }
      setError(message);
      setIsSubmitting(false);
    }
  }

  // Enrollment screen: fetch the QR as soon as it opens.
  const enrollChallenge = screen.kind === 'enroll-totp' ? screen.challenge : null;
  useEffect(() => {
    if (!enrollChallenge) return;
    let cancelled = false;
    apiClient
      .loginTotpSetup(enrollChallenge)
      .then((s) => { if (!cancelled) setSetup(s); })
      .catch((err: unknown) => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, [enrollChallenge]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    switch (screen.kind) {
      case 'password':
        void run(() => apiClient.login({ email, password }));
        return;
      case 'change-password':
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
          setError(`Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`);
          return;
        }
        if (newPassword !== repeatPassword) {
          setError('Hai lần nhập mật khẩu mới không khớp');
          return;
        }
        void run(() => apiClient.loginNewPassword({ challenge: screen.challenge, newPassword }));
        return;
      case 'enroll-totp':
        void run(() => apiClient.loginTotp({ challenge: screen.challenge, code, trustDevice, enroll: true }));
        return;
      case 'totp':
        void run(() => apiClient.loginTotp({ challenge: screen.challenge, code, trustDevice }));
        return;
      case 'backup-codes':
        enterApp();
        return;
    }
  }

  const trustBox = (
    <label className="login-check">
      <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
      <span>Tin thiết bị này 30 ngày (không hỏi mã nữa)</span>
    </label>
  );

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Secure Access</p>
        <h1>Đăng nhập Market Analysis</h1>

        <form className="login-form" onSubmit={onSubmit}>
          {screen.kind === 'password' && (
            <>
              <p className="lead">Nhập email và mật khẩu của bạn.</p>
              <label className="settings-label" htmlFor="email">Email</label>
              <input
                id="email"
                className="settings-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />

              <label className="settings-label" htmlFor="password">Mật khẩu</label>
              <input
                id="password"
                className="settings-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />

              <button className="btn btn--primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Đang kiểm tra…' : 'Tiếp tục'}
              </button>
            </>
          )}

          {screen.kind === 'change-password' && (
            <>
              <p className="lead">
                Bạn đang dùng mật khẩu tạm. Đặt mật khẩu mới (ít nhất {MIN_PASSWORD_LENGTH} ký tự) trước khi tiếp tục.
              </p>
              <label className="settings-label" htmlFor="new-password">Mật khẩu mới</label>
              <input
                id="new-password"
                className="settings-input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <label className="settings-label" htmlFor="repeat-password">Nhập lại mật khẩu mới</label>
              <input
                id="repeat-password"
                className="settings-input"
                type="password"
                autoComplete="new-password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                required
              />
              <button className="btn btn--primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Đang lưu…' : 'Đổi mật khẩu'}
              </button>
            </>
          )}

          {screen.kind === 'enroll-totp' && (
            <>
              <p className="lead">
                Bật xác thực 2 lớp: mở Google Authenticator / Authy, quét mã QR rồi nhập mã 6 số đang hiện.
              </p>
              {setup ? (
                <div className="login-qr">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the API */}
                  <img src={setup.qrDataUrl} alt="Mã QR xác thực 2 lớp" width={220} height={220} />
                  <p className="login-secret">
                    Không quét được? Nhập khoá thủ công:
                    <code>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                  </p>
                </div>
              ) : (
                <p className="lead">Đang tạo mã QR…</p>
              )}
              <label className="settings-label" htmlFor="totp-code">Mã 6 số</label>
              <input
                id="totp-code"
                className="settings-input login-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
              {trustBox}
              <button className="btn btn--primary" type="submit" disabled={isSubmitting || !setup}>
                {isSubmitting ? 'Đang xác nhận…' : 'Bật 2FA và đăng nhập'}
              </button>
            </>
          )}

          {screen.kind === 'totp' && (
            <>
              <p className="lead">Nhập mã 6 số trong app xác thực, hoặc một backup code nếu mất điện thoại.</p>
              <label className="settings-label" htmlFor="totp-code">Mã xác thực</label>
              <input
                id="totp-code"
                className="settings-input login-code-input"
                autoComplete="one-time-code"
                maxLength={32}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoFocus
                required
              />
              {trustBox}
              <button className="btn btn--primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Đang xác nhận…' : 'Đăng nhập'}
              </button>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => { setScreen({ kind: 'password' }); setPassword(''); setError(null); }}
              >
                Quay lại
              </button>
            </>
          )}

          {screen.kind === 'backup-codes' && (
            <>
              <p className="lead">
                Đã bật 2FA. Đây là <strong>10 backup code</strong>, mỗi mã dùng được một lần khi mất điện thoại.
                Chúng chỉ hiện <strong>một lần</strong> — hãy lưu vào trình quản lý mật khẩu hoặc giấy.
              </p>
              <ol className="login-codes">
                {screen.codes.map((c) => <li key={c}><code>{c}</code></li>)}
              </ol>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(screen.codes.join('\n')); }}
              >
                Copy tất cả
              </button>
              <label className="login-check">
                <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
                <span>Tôi đã lưu các mã này</span>
              </label>
              <button className="btn btn--primary" type="submit" disabled={!savedCodes}>
                Vào app
              </button>
            </>
          )}

          {error ? <p className="settings-status settings-status--error">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
