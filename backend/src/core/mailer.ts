import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config";
import { logger } from "./logger";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Messages "sent" while NODE_ENV=test, so tests can read reset links. */
export const testOutbox: MailMessage[] = [];

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: config.EMAIL_USER, pass: config.EMAIL_PASS },
    });
  }
  return transporter;
};

export const sendMail = async (message: MailMessage): Promise<void> => {
  if (config.isTest) {
    testOutbox.push(message);
    return;
  }

  if (!config.mailEnabled) {
    // Never fail the request (sign-up, invitations) just because email isn't set up
    if (config.isProduction && !config.MAIL_LOG_CONTENT) {
      logger.warn({ subject: message.subject }, "Email not configured — message not sent (set EMAIL_USER/EMAIL_PASS)");
      return;
    }
    // Development (or opted in): print the message, links included, instead of sending it
    logger.warn({ to: message.to, subject: message.subject, text: message.text }, "Email not configured — message logged");
    return;
  }

  await getTransporter().sendMail({ from: config.EMAIL_USER, ...message });
};
