import axios from "axios";
import FormData from "form-data";
let data = new FormData();

// const credentials = {
//   apiKey: process.env.SMS_API_KEY,
//   username: process.env.SMS_API_USERNAME,
// };

function sendMessage(to: any, message: any, from: any) {
    console.log('Sending sms')
  data.append("username", process.env.SMS_API_USERNAME);
  data.append("to", to);
  data.append("message", message);
//   data.append("from", from);

  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://api.africastalking.com/version1/messaging",
    headers: {
      apiKey: process.env.SMS_API_KEY,
      ...data.getHeaders(),
    },
    data: data,
  };

  axios
    .request(config)
    .then((response) => {
      console.log(JSON.stringify(response.data));
    })
    .catch((error) => {
      console.log(error);
    });
}

export default sendMessage;
