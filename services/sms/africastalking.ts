export interface AfricasTalkingConfig {
  username?: string;
  apiKey?: string;
  senderId?: string;
  /** Gets a short notice when a send fails; only the legacy route sets it by default. */
  fallbackNumber?: string;
  /** Names the env vars in the "not set" error, without ever printing their values. */
  credentialEnv: string;
}

/**
 * Builds a send function for one route. The Africa's Talking client is
 * created on first send, so a missing key never crashes boot or route setup.
 */
export function africasTalking(config: AfricasTalkingConfig) {
  let smsService: any = null;

  function getSms() {
    if (smsService) return smsService;
    if (!config.apiKey || !config.username) {
      throw new Error(`${config.credentialEnv} are not set`);
    }
    const AfricasTalking = require("africastalking")({ apiKey: config.apiKey, username: config.username });
    smsService = AfricasTalking.SMS;
    return smsService;
  }

  return async function send(to: string, message: string, from?: string): Promise<void> {
    let sms: any;
    try {
      sms = getSms();
    } catch (err) {
      console.error(`SMS to ${to} not sent:`, err);
      return;
    }

    try {
      const res = await sms.send({ to, message, from: config.senderId || from || "Shapeherd" });
      console.log("SMS sent", JSON.stringify(res));
    } catch (err) {
      console.error(`SMS to ${to} failed:`, err);
      if (config.fallbackNumber) {
        sms.send({ to: config.fallbackNumber, message: `Sending sms failed for ${to}` }).catch(() => {});
      }
    }
  };
}
