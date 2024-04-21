const accountSid = "AC817ae24cf9b423fe557f8d8892f34b0d";
const authToken = "49d00428ee53cedac9bf9490fe8efcc7";
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
