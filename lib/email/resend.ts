import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendInviteEmail(params: { to: string; brandName: string; inviteUrl: string }) {
  if (!resend) {
    console.log("[email:mock] invite", params);
    return { id: "mock-email-id" };
  }

  return resend.emails.send({
    from: process.env.RESEND_FROM || "Distributor OS <hello@example.com>",
    to: params.to,
    subject: `${params.brandName} invited you to their distributor portal`,
    html: `<p>You have been invited to access ${params.brandName}'s private distributor portal.</p><p><a href="${params.inviteUrl}">Open invite</a></p>`
  });
}

export async function sendNotificationEmail(params: { to: string; subject: string; body: string }) {
  if (!resend) {
    console.log("[email:mock] notification", params);
    return { id: "mock-email-id" };
  }

  return resend.emails.send({
    from: process.env.RESEND_FROM || "Distributor OS <hello@example.com>",
    to: params.to,
    subject: params.subject,
    html: `<p>${params.body}</p>`
  });
}
