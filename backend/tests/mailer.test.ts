import { config } from "../src/core/config";
import { logger } from "../src/core/logger";
import { sendMail, testOutbox } from "../src/core/mailer";

/** Production without SMTP must not break sign-up, and must not put links in the logs. */
describe("sendMail without email credentials", () => {
  const c = config as unknown as Record<string, unknown>;
  const saved = { isTest: c.isTest, isProduction: c.isProduction, mailEnabled: c.mailEnabled, MAIL_LOG_CONTENT: c.MAIL_LOG_CONTENT };
  afterEach(() => Object.assign(c, saved));
  const msg = { to: "a@example.com", subject: "Verify your email", text: "Open https://app/verify/SECRET-TOKEN", html: "<a>x</a>" };

  it("production: skips the message without failing and without logging its content", async () => {
    Object.assign(c, { isTest: false, isProduction: true, mailEnabled: false, MAIL_LOG_CONTENT: undefined });
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    await expect(sendMail(msg)).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(warn.mock.calls)).toContain("not sent");
    warn.mockRestore();
    expect(testOutbox).toHaveLength(0);
  });

  it("production with MAIL_LOG_CONTENT, or development: logs the message instead", async () => {
    for (const env of [{ isProduction: true, MAIL_LOG_CONTENT: true }, { isProduction: false, MAIL_LOG_CONTENT: undefined }]) {
      Object.assign(c, { isTest: false, mailEnabled: false, ...env });
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
      await sendMail(msg);
      expect(JSON.stringify(warn.mock.calls)).toContain("SECRET-TOKEN");
      warn.mockRestore();
    }
  });
});
