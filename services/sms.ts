let smsService: any = null;

/** Africa's Talking is initialised on first use so that a missing key does not crash boot. */
function getSms() {
  if (smsService) return smsService;
  const credentials = {
    apiKey: process.env.SMS_API_KEY,
    username: process.env.SMS_API_USERNAME,
  };
  if (!credentials.apiKey || !credentials.username) {
    throw new Error("SMS_API_KEY and SMS_API_USERNAME are not set");
  }
  const AfricasTalking = require("africastalking")(credentials);
  smsService = AfricasTalking.SMS;
  return smsService;
}

function sendMessage(to: string, message: string, from?: string) {
  const options = {
    to,
    message,
    from: process.env.SMS_SENDER_ID || from || "Shapeherd",
  };

  let sms: any;
  try {
    sms = getSms();
  } catch (err) {
    console.error(`SMS to ${to} not sent:`, err);
    return;
  }

  sms
    .send(options)
    .then((res: any) => {
      console.log("SMS sent", JSON.stringify(res));
    })
    .catch((err: any) => {
      console.error(`SMS to ${to} failed:`, err);
      const fallback = process.env.SMS_FALLBACK_NUMBER;
      if (fallback) {
        sms
          .send({ to: fallback, message: `Sending sms failed for ${to}` })
          .catch(() => {});
      }
    });
}

export default sendMessage;
