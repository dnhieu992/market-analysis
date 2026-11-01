'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createApiClient } from '@web/shared/api/client';
import type { AuthDevice, AuthSecurity } from '@web/shared/api/types';

const apiClient = createApiClient();

const MIN_PASSWORD_LENGTH = 10;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Có lỗi xảy ra, thử lại';
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

/** "Chrome · macOS" style label from a user-agent string. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Không rõ thiết bị';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : /curl|node|axios/i.test(ua) ? 'Script'
    : 'Trình duyệt';
  const os =
    /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Security card of /profile: 2FA status + backup codes, password change,
 * signed-in sessions and trusted (2FA-remembered) browsers.
 */
export function AccountSecurity() {
  const router = useRouter();
  const [security, setSecurity] = useState<AuthSecurity | null>(null);
  const [sessions, setSessions] = useState<AuthDevice[]>([]);
  const [devices, setDevices] = useState<AuthDevice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [sec, sess, devs] = await Promise.all([
        apiClient.fetchAuthSecurity(),
        apiClient.fetchAuthSessions(),
        apiClient.fetchTrustedDevices()
      ]);
      setSecurity(sec);
      setSessions(sess);
      setDevices(devs);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── Backup codes ──
  const [backupCode, setBackupCode] = useState('');
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  async function regenerate() {
    setBackupStatus({ busy: true, error: null });
    try {
      setNewCodes(await apiClient.regenerateBackupCodes(backupCode));
      setBackupCode('');
      setBackupStatus({ busy: false, error: null });
      void reload();
    } catch (err) {
      setBackupStatus({ busy: false, error: errorText(err) });
    }
  }

  // ── Password ──
  const [pw, setPw] = useState({ current: '', next: '', repeat: '', code: '' });
  const [pwStatus, setPwStatus] = useState<{ busy: boolean; error: string | null; done: boolean }>({ busy: false, error: null, done: false });

  async function changePassword() {
    if (pw.next.length < MIN_PASSWORD_LENGTH) {
      setPwStatus({ busy: false, error: `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`, done: false });
      return;
    }
    if (pw.next !== pw.repeat) {
      setPwStatus({ busy: false, error: 'Hai lần nhập mật khẩu mới không khớp', done: false });
      return;
    }
    setPwStatus({ busy: true, error: null, done: false });
    try {
      await apiClient.changePassword({ currentPassword: pw.current, newPassword: pw.next, code: pw.code });
      setPw({ current: '', next: '', repeat: '', code: '' });
      setPwStatus({ busy: false, error: null, done: true });
      void reload();
    } catch (err) {
      setPwStatus({ busy: false, error: errorText(err), done: false });
    }
  }

  // ── Sessions / devices ──
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  function revokeOthers() {
    if (!window.confirm('Đăng xuất tất cả thiết bị khác và bỏ tin cậy chúng?')) return;
    void act(() => apiClient.revokeOtherAuthSessions());
  }

  async function logout() {
    await apiClient.logout().catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  const otherSessions = sessions.filter((s) => !s.current).length;

  return (
    <section className="settings-card">
      <p className="settings-card-title">Bảo mật</p>
      {loadError && <p className="settings-status settings-status--error">{loadError}</p>}

      <div className="settings-fields">
        {/* 2FA */}
        <div className="settings-field">
          <label className="settings-label">Xác thực 2 lớp (TOTP)</label>
          <p className="settings-value">
            {security?.totpEnabledAt ? `Đang bật từ ${fmtTime(security.totpEnabledAt)}` : 'Chưa bật'}
            {security ? ` · còn ${security.backupCodesRemaining}/10 backup code` : ''}
          </p>
          {newCodes ? (
            <div className="security-codes">
              <p className="security-note">Backup code mới — chỉ hiện một lần, mã cũ đã hết hiệu lực:</p>
              <ol className="login-codes">
                {newCodes.map((c) => <li key={c}><code>{c}</code></li>)}
              </ol>
              <div className="security-row">
                <button className="btn btn--secondary" type="button" onClick={() => { void navigator.clipboard?.writeText(newCodes.join('\n')); }}>
                  Copy tất cả
                </button>
                <button className="btn btn--secondary" type="button" onClick={() => setNewCodes(null)}>Đã lưu, ẩn đi</button>
              </div>
            </div>
          ) : (
            <div className="security-row">
              <input
                className="settings-input security-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Mã 6 số"
                maxLength={7}
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value)}
              />
              <button
                className="btn btn--secondary"
                type="button"
                disabled={backupStatus.busy || backupCode.trim().length < 6}
                onClick={() => { void regenerate(); }}
              >
                {backupStatus.busy ? 'Đang tạo…' : 'Tạo lại backup code'}
              </button>
            </div>
          )}
          {backupStatus.error && <p className="settings-status settings-status--error">{backupStatus.error}</p>}
        </div>

        <hr className="settings-divider" />

        {/* Password */}
        <form
          className="settings-field"
          onSubmit={(e) => { e.preventDefault(); void changePassword(); }}
        >
          <label className="settings-label">Đổi mật khẩu</label>
          <p className="security-note">
            Lần đổi gần nhất: {fmtTime(security?.passwordChangedAt ?? null)}. Đổi xong, các thiết bị khác sẽ bị đăng xuất.
          </p>
          <input
            className="settings-input"
            type="password"
            autoComplete="current-password"
            placeholder="Mật khẩu hiện tại"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            required
          />
          <input
            className="settings-input"
            type="password"
            autoComplete="new-password"
            placeholder={`Mật khẩu mới (≥ ${MIN_PASSWORD_LENGTH} ký tự)`}
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            required
          />
          <input
            className="settings-input"
            type="password"
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu mới"
            value={pw.repeat}
            onChange={(e) => setPw({ ...pw, repeat: e.target.value })}
            required
          />
          <input
            className="settings-input"
            autoComplete="one-time-code"
            placeholder="Mã 6 số (hoặc backup code)"
            maxLength={32}
            value={pw.code}
            onChange={(e) => setPw({ ...pw, code: e.target.value })}
            required
          />
          <div className="security-row">
            <button className="btn btn--primary" type="submit" disabled={pwStatus.busy}>
              {pwStatus.busy ? 'Đang đổi…' : 'Đổi mật khẩu'}
            </button>
            {pwStatus.done && <span className="settings-status settings-status--success">✓ Đã đổi mật khẩu</span>}
          </div>
          {pwStatus.error && <p className="settings-status settings-status--error">{pwStatus.error}</p>}
        </form>

        <hr className="settings-divider" />

        {/* Sessions */}
        <div className="settings-field">
          <label className="settings-label">Phiên đăng nhập ({sessions.length})</label>
          <ul className="security-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{describeUserAgent(s.userAgent)}</strong>
                  {s.current && <span className="security-badge">Thiết bị này</span>}
                  <p className="security-note">
                    IP {s.ip ?? '?'} · dùng lần cuối {fmtTime(s.lastUsedAt)} · hết hạn {fmtTime(s.expiresAt)}
                  </p>
                </div>
                {!s.current && (
                  <button className="btn btn--secondary" type="button" onClick={() => { void act(() => apiClient.revokeAuthSession(s.id)); }}>
                    Đăng xuất
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Trusted devices */}
        <div className="settings-field">
          <label className="settings-label">Thiết bị tin cậy — bỏ qua mã 2FA ({devices.length})</label>
          {devices.length === 0 ? (
            <p className="security-note">Chưa có thiết bị nào.</p>
          ) : (
            <ul className="security-list">
              {devices.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{describeUserAgent(d.userAgent)}</strong>
                    {d.current && <span className="security-badge">Thiết bị này</span>}
                    <p className="security-note">
                      IP {d.ip ?? '?'} · tin cậy từ {fmtTime(d.createdAt)} · hết hạn {fmtTime(d.expiresAt)}
                    </p>
                  </div>
                  <button className="btn btn--secondary" type="button" onClick={() => { void act(() => apiClient.revokeTrustedDevice(d.id)); }}>
                    Bỏ tin cậy
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {actionError && <p className="settings-status settings-status--error">{actionError}</p>}

        <div className="security-row">
          <button
            className="btn btn--danger"
            type="button"
            disabled={otherSessions === 0 && devices.every((d) => d.current)}
            onClick={revokeOthers}
          >
            Đăng xuất các thiết bị khác
          </button>
          <button className="btn btn--secondary" type="button" onClick={() => { void logout(); }}>
            Đăng xuất
          </button>
        </div>
      </div>
    </section>
  );
}
