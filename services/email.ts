import { webUrl } from "./tickets";
import { formatDateTime } from "./format";

/** Ticket emails go out only when SMTP is configured; otherwise delivery is SMS only. */
export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
}

let transporterPromise: Promise<any> | null = null;
async function transporter() {
  if (!transporterPromise) {
    transporterPromise = import("nodemailer").then((nodemailer) =>
      nodemailer.default.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    );
  }
  return transporterPromise;
}

function escape(text: any) {
  return String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/** Password reset link. Resolves false when email is not configured or the send fails. */
export async function sendPasswordResetEmail(to: string, link: string) {
  if (!emailConfigured() || !to) return false;
  try {
    const mailer = await transporter();
    await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: "Reset your EvenTixr password",
      text: `Open this link to choose a new password. It works once and expires in one hour.\n${link}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#17141a">
        <p>Open the link below to choose a new password. It works once and expires in one hour.</p>
        <p><a href="${link}" style="background:#e8541e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Choose a new password</a></p>
        <p style="color:#5d5864;font-size:13px">If you did not ask for this, you can ignore the email.</p></div>`,
    });
    return true;
  } catch (err) {
    console.error(`Password reset email to ${to} failed:`, err);
    return false;
  }
}

/** Sends one ticket with its QR code inline. Resolves false when email is not configured or the send fails. */
export async function sendTicketEmail(to: string, ticket: any, event: any | null) {
  if (!emailConfigured() || !to) return false;
  const link = `${webUrl()}/tickets/${ticket._id}?showOnly=1`;
  const when = event?.date ? formatDateTime(event.date) : "";
  const title = event?.title || "Your ticket";
  const qr = typeof ticket.qrCode === "string" && ticket.qrCode.startsWith("data:image/png;base64,")
    ? Buffer.from(ticket.qrCode.slice("data:image/png;base64,".length), "base64")
    : null;
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#17141a">
      <h1 style="font-size:22px;margin:0 0 8px">${escape(title)}</h1>
      <p style="margin:0 0 16px;color:#5d5864">${escape(when)}${event?.location ? ` · ${escape(event.location)}` : ""}</p>
      <p style="margin:0 0 16px">Ticket number <strong style="font-size:20px">${escape(ticket.number)}</strong>
         · ${escape(ticket.ticketPackage?.title || "")}</p>
      ${qr ? `<p><img src="cid:ticket-qr" width="200" height="200" alt="Ticket QR code"></p>` : ""}
      <p><a href="${link}" style="background:#e8541e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Open your ticket</a></p>
      <p style="color:#5d5864;font-size:13px">Show the QR code at the gate. A screenshot works too.</p>
    </div>`;
  try {
    const mailer = await transporter();
    await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: `Your ticket ${ticket.number} for ${title}`,
      text: `${title}\n${when}\nTicket number ${ticket.number} (${ticket.ticketPackage?.title || ""})\n${link}`,
      html,
      attachments: qr ? [{ filename: `ticket-${ticket.number}.png`, content: qr, cid: "ticket-qr" }] : [],
    });
    return true;
  } catch (err) {
    console.error(`Ticket email to ${to} failed:`, err);
    return false;
  }
}
