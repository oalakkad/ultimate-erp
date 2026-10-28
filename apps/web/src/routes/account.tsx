import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  backupCodesResponseSchema,
  okResponseSchema,
  type Session,
  sessionListResponseSchema,
  twoFactorSetupResponseSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  LoadingState,
  StatusChip,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch } from '../app/switches.js';
import { FormError } from '../components/auth-layout.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { useAccess, useMe } from '../lib/session.js';

/** My account: language, two-factor authentication and signed-in sessions. */
export function AccountPage() {
  const { t } = useI18n();
  const me = useMe();
  const access = useAccess(true);
  if (!me.data) return <LoadingState label={t('ui.common.loading')} />;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold tracking-tight">{t('ui.account.title')}</h1>
      <Card title={t('ui.account.profile')}>
        <div className="grid gap-1">
          <b>{me.data.user.name}</b>
          <small className="text-ink-3" dir="ltr">
            {me.data.user.email}
          </small>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13.5px] font-semibold">{t('ui.account.language')}</span>
          <LanguageSwitch />
        </div>
      </Card>
      <TwoFactorCard
        enabled={me.data.user.twoFactorEnabled}
        required={access.data?.twoFactorRequired ?? false}
      />
      <SessionsCard />
    </div>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <div className="grid gap-2 rounded-tile bg-frame p-4">
      <b>{t('ui.account.backupCodes')}</b>
      <p className="text-[13px] text-ink-2">{t('ui.account.backupCodesBody')}</p>
      <ul
        className="grid grid-cols-2 gap-1 font-mono text-[13.5px]"
        dir="ltr"
        data-testid="backup-codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        onClick={() =>
          void navigator.clipboard.writeText(codes.join('\n')).then(() => {
            toast({ tone: 'good', title: t('ui.account.copied') });
          })
        }
      >
        {t('ui.account.copyCodes')}
      </Button>
    </div>
  );
}

/** Asks for the password before a sensitive change (the server checks it again). */
function PasswordStep({
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (password: string) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (password) onSubmit(password);
      }}
    >
      <TextField
        label={t('ui.auth.password')}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
        }}
      />
      <FormError error={error} />
      <Button type="submit" className="w-fit" loading={pending} disabled={!password}>
        {submitLabel}
      </Button>
    </form>
  );
}

function TwoFactorCard({ enabled, required }: { enabled: boolean; required: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<'idle' | 'password' | 'scan'>('idle');
  const [setup, setSetup] = useState<{ totpUri: string; backupCodes: string[] } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<'disable' | 'regenerate' | null>(null);

  const start = useMutation({
    mutationFn: (password: string) =>
      api('/auth/two-factor/enable', {
        method: 'POST',
        body: { password },
        schema: twoFactorSetupResponseSchema,
      }),
    onSuccess: (result) => {
      setSetup(result);
      setStage('scan');
    },
  });
  const confirm = useMutation({
    mutationFn: () =>
      api('/auth/two-factor/confirm', { method: 'POST', body: { code }, schema: okResponseSchema }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.account.enabled') });
      setStage('idle');
      setSetup(null);
      setCode('');
      await queryClient.invalidateQueries();
    },
  });
  const disable = useMutation({
    mutationFn: (password: string) =>
      api('/auth/two-factor/disable', {
        method: 'POST',
        body: { password },
        schema: okResponseSchema,
      }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.account.disabled') });
      setDialog(null);
      await queryClient.invalidateQueries();
    },
  });
  const regenerate = useMutation({
    mutationFn: (password: string) =>
      api('/auth/two-factor/backup-codes', {
        method: 'POST',
        body: { password },
        schema: backupCodesResponseSchema,
      }),
    onSuccess: (result) => {
      setDialog(null);
      setNewCodes(result.backupCodes);
    },
  });

  // The QR code is drawn locally: the secret never leaves the browser for a third-party service.
  useEffect(() => {
    if (!setup) return;
    let live = true;
    void QRCode.toString(setup.totpUri, { type: 'svg', margin: 1, width: 192 }).then((svg) => {
      if (live) setQr(svg);
    });
    return () => {
      live = false;
    };
  }, [setup]);
  const secret = setup ? (new URL(setup.totpUri).searchParams.get('secret') ?? '') : '';

  return (
    <Card
      id="security"
      title={t('ui.account.security')}
      action={
        <StatusChip
          status={enabled ? 'good' : required ? 'bad' : 'warn'}
          label={enabled ? t('ui.account.mfaOn') : t('ui.account.mfaOff')}
        />
      }
    >
      {required && !enabled && (
        <p role="alert" className="rounded-tile bg-butter p-3 text-[13.5px] text-butter-ink">
          {t('ui.account.mfaRequired')}
        </p>
      )}

      {!enabled && stage === 'idle' && (
        <Button
          className="w-fit"
          onClick={() => {
            setStage('password');
          }}
        >
          {t('ui.account.setUp')}
        </Button>
      )}
      {!enabled && stage === 'password' && (
        <>
          <p className="text-[13.5px] text-ink-2">{t('ui.account.setupPassword')}</p>
          <PasswordStep
            submitLabel={t('ui.account.continue')}
            pending={start.isPending}
            error={start.error}
            onSubmit={(password) => {
              start.mutate(password);
            }}
          />
        </>
      )}
      {!enabled && stage === 'scan' && setup && (
        <div className="grid gap-4">
          <p className="text-[13.5px] text-ink-2">{t('ui.account.scan')}</p>
          <div className="flex flex-wrap items-start gap-4">
            <div
              role="img"
              aria-label={t('ui.account.scan')}
              className="size-48 rounded-tile bg-white p-2"
              // Generated locally by the qrcode library from the server's otpauth URI.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <div className="grid min-w-0 gap-1">
              <span className="text-[13px] text-ink-2">{t('ui.account.manualKey')}</span>
              <code
                className="break-all font-mono text-[13.5px]"
                dir="ltr"
                data-testid="totp-secret"
              >
                {secret}
              </code>
            </div>
          </div>
          <BackupCodes codes={setup.backupCodes} />
          <form
            noValidate
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              confirm.mutate();
            }}
          >
            <TextField
              label={t('ui.account.confirmCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.trim());
              }}
            />
            <FormError error={confirm.error} />
            <Button
              type="submit"
              className="w-fit"
              loading={confirm.isPending}
              disabled={code.length === 0}
            >
              {t('ui.account.enable')}
            </Button>
          </form>
        </div>
      )}

      {enabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setDialog('regenerate');
            }}
          >
            {t('ui.account.regenerate')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setDialog('disable');
            }}
          >
            {t('ui.account.disable')}
          </Button>
        </div>
      )}
      {newCodes && <BackupCodes codes={newCodes} />}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            disable.reset();
            regenerate.reset();
          }
        }}
        title={dialog === 'disable' ? t('ui.account.disable') : t('ui.account.regenerate')}
        description={t('ui.account.disableBody')}
        closeLabel={t('ui.common.close')}
      >
        {dialog === 'disable' && (
          <PasswordStep
            submitLabel={t('ui.account.disable')}
            pending={disable.isPending}
            error={disable.error}
            onSubmit={(password) => {
              disable.mutate(password);
            }}
          />
        )}
        {dialog === 'regenerate' && (
          <PasswordStep
            submitLabel={t('ui.account.regenerate')}
            pending={regenerate.isPending}
            error={regenerate.error}
            onSubmit={(password) => {
              regenerate.mutate(password);
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}

function SessionsCard() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api('/auth/sessions', { schema: sessionListResponseSchema }),
  });
  const revoke = useMutation({
    mutationFn: (session: Session) =>
      api(`/auth/sessions/${session.id}`, { method: 'DELETE', schema: okResponseSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err) => {
      toast({ tone: 'bad', title: errorText(t, err) });
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () =>
      api('/auth/sessions/revoke-others', { method: 'POST', schema: okResponseSchema }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.account.signedOutOthers') });
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => {
      toast({ tone: 'bad', title: errorText(t, err) });
    },
  });
  const list = sessions.data?.sessions ?? [];

  return (
    <Card
      title={t('ui.account.sessions')}
      action={
        list.length > 1 ? (
          <Button
            size="sm"
            variant="secondary"
            loading={revokeOthers.isPending}
            onClick={() => {
              revokeOthers.mutate();
            }}
          >
            {t('ui.account.signOutOthers')}
          </Button>
        ) : undefined
      }
    >
      {sessions.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {sessions.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, sessions.error)}
          reference={errorReference(t, sessions.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void sessions.refetch()}
        />
      )}
      <ul className="grid gap-2">
        {list.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
          >
            <div className="min-w-0 flex-1">
              <b className="block truncate" dir="ltr">
                {session.userAgent ?? '—'}
              </b>
              <small className="text-ink-3">
                {session.current
                  ? t('ui.account.current')
                  : t('ui.account.lastActive', {
                      date: formatDate(locale, new Date(session.lastActiveAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                {session.ipAddress && <span dir="ltr"> · {session.ipAddress}</span>}
              </small>
            </div>
            {!session.current && (
              <Button
                size="sm"
                variant="secondary"
                loading={revoke.isPending && revoke.variables.id === session.id}
                onClick={() => {
                  revoke.mutate(session);
                }}
              >
                {t('ui.account.signOutSession')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
