import { enUi } from './en-ui.js';

/** English catalog — the reference: every other locale must have exactly these keys. */
export const en = {
  ui: enUi,
  roles: {
    owner: 'Owner',
    ceo: 'CEO',
    manager: 'Manager',
    team_leader: 'Team Leader',
    employee: 'Employee',
    finance: 'Finance',
    hr_payroll: 'HR & Payroll',
    technical_admin: 'Technical Administrator',
  },
  email: {
    signature: 'Ultimate ERP',
    ignoreNotice: 'If you did not request this, you can ignore this email.',
    verifyEmail: {
      subject: 'Confirm your email address',
      body: 'Hello {name},\n\nPlease confirm your email address to finish creating your account:\n\n{url}\n\nThis link expires in 1 hour.',
    },
    existingAccount: {
      subject: 'Someone tried to sign up with your email',
      body: 'Hello {name},\n\nSomeone tried to create a new account with this email address. You already have an account, so nothing was changed.\n\nIf you forgot your password, you can reset it from the sign-in page.',
    },
    resetPassword: {
      subject: 'Reset your password',
      body: 'Hello {name},\n\nUse this link to choose a new password:\n\n{url}\n\nThis link expires in 1 hour. Resetting your password signs you out on all devices.',
    },
    passwordChanged: {
      subject: 'Your password was changed',
      body: 'Hello {name},\n\nThe password for your account was just changed. If this was not you, reset your password immediately and contact your administrator.',
    },
    newDevice: {
      subject: 'New sign-in to your account',
      body: 'Hello {name},\n\nYour account was just signed in from a new device:\n\nBrowser: {device}\nIP address: {ip}\nTime (UTC): {time}\n\nIf this was not you, change your password now and sign out all other sessions.',
    },
    accountLocked: {
      subject: 'Your account was temporarily locked',
      body: 'Hello {name},\n\nThere were several failed sign-in attempts on your account, so sign-in is blocked for 15 minutes.\n\nIf this was not you, consider changing your password once the lock expires.',
    },
    twoFactorEnabled: {
      subject: 'Two-factor authentication turned on',
      body: 'Hello {name},\n\nTwo-factor authentication is now on for your account. Keep your backup codes somewhere safe.',
    },
    invitation: {
      subject: 'You are invited to join {company}',
      body: 'Hello,\n\n{inviter} invited you to join {company} on Ultimate ERP as {role}.\n\nOpen this link to see the invitation:\n\n{url}\n\nThe invitation expires in 7 days. You will need to sign in (or create an account) with this email address to accept it.',
    },
    twoFactorDisabled: {
      subject: 'Two-factor authentication turned off',
      body: 'Hello {name},\n\nTwo-factor authentication was turned off for your account. If this was not you, change your password immediately.',
    },
  },
} as const;
