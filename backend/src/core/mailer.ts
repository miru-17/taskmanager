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
    if (config.isProduction) throw new Error("Email is not configured");
    // Development convenience: no SMTP credentials, so print the message instead
    logger.warn({ to: message.to, subject: message.subject, text: message.text }, "Email not configured — message logged");
    return;
  }

  await getTransporter().sendMail({ from: config.EMAIL_USER, ...message });
};
