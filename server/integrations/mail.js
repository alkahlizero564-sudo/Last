// إرسال البريد عبر Gmail (كلمة سر التطبيقات) أو Brevo SMTP.
import nodemailer from 'nodemailer';

export function transportFor(settings) {
  const provider = settings.mail?.provider || 'gmail';
  if (provider === 'brevo') {
    const { login, key, sender } = settings.brevo;
    if (!login || !key || !sender) throw new Error('إعدادات Brevo ناقصة (Login + مفتاح SMTP + إيميل المرسِل)');
    return {
      from: sender,
      transport: nodemailer.createTransport({ host: 'smtp-relay.brevo.com', port: 587, secure: false, auth: { user: login, pass: key } }),
    };
  }
  const { user, appPassword } = settings.gmail;
  if (!user || !appPassword) throw new Error('إعدادات Gmail ناقصة (الإيميل + كلمة سر التطبيقات)');
  return {
    from: user,
    transport: nodemailer.createTransport({ service: 'gmail', auth: { user, pass: appPassword.replace(/\s/g, '') } }),
  };
}

export async function sendMail(settings, { to, subject, html, attachments }) {
  const { from, transport } = transportFor(settings);
  return transport.sendMail({ from: `APK Forge <${from}>`, to, subject, html, attachments });
}

export async function verifyMail(settings) {
  const { transport } = transportFor(settings);
  await transport.verify();
  return true;
}
