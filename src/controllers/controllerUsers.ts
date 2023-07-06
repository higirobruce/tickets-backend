import { userModel } from "../models/users";

export async function getAllUsers() {
  try {
    let users = await userModel.find({});
    return users;
  } catch (err) {
    throw Error(`${err}`);
  }
}
