const accountSid = "";
const authToken = "";
const client = require("twilio")(accountSid, authToken);

export function twilioSend() {
  return client.messages
    .create({
      body: "oiuuytrdfghjkjh",
      to: "+250783575582",
      from: '+16562283807',
    })
    .then((message: any) => console.log(message.sid)).catch((err:any)=>{
        console.log(err)
    })
    // .done();
}
