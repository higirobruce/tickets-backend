import { userModel } from "../models/users";
import { validPassword } from "../services/users";

const WITHOUT_CREDENTIALS = "-password -salt";

export async function getAllUsers() {
  return userModel.find({}).select(WITHOUT_CREDENTIALS);
}

export async function countUsers() {
  return userModel.countDocuments();
}

export async function getUser(username: any, password: any) {
  const user = await userModel.findOne({ email: username });
  if (user && validPassword(password, user.password, user.salt)) {
    return user;
  }
  return null;
}

export async function getUserById(id: any) {
  return userModel.findById(id).select(WITHOUT_CREDENTIALS);
}

export async function saveUser(user: any) {
  const nUser = new userModel(user);
  return nUser.save();
}
