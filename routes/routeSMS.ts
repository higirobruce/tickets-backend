// Set your app credentials
const credentials = {
  apiKey: process.env.SMS_API_KEY,
  username: process.env.SMS_API_USERNAME,
};

// Initialize the SDK
const AfricasTalking = require("africastalking")(credentials);

// Get the SMS service
const sms = AfricasTalking.SMS;

function sendMessage(to: any, message: any, from: any) {
  const options = {
    // Set the numbers you want to send to in international format
    to,
    // Set your message
    message,
    // Set your shortCode or senderId
    // from: "XXYYZZ",
  };

  // That’s it, hit send and we’ll take care of the rest
  sms
    .send(
      options
    ) /* The code `then(console.log).catch((err:any)=>{ console.log(err)
  sms.send(options) });` is handling the promise returned by the `sms.send()`
  method. */
    .then(console.log)
    .catch((err: any) => {
      console.log(err);
      sms
        .send(options)
        .then(console.log)
        .catch((err2: any) => {
          console.log(err2);
          sms.send(options);
        });
    });
}

export default sendMessage;
