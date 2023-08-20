import { userModel } from "../models/users";
import * as bcrypt from "bcrypt";
import { validPassword } from "../services/users";

export async function getAllUsers() {
  try {
    let users = await userModel.find({});
    return users;
  } catch (err) {
    throw Error(`${err}`);
  }
}

export async function getUser(username: any, password: any) {
  try {
    let user = await userModel.findOne({ email: username });
    if (validPassword(password, user?.password)) {
      return user;
    } else {
      return false;
    }
  } catch (err) {
    throw Error(`${err}`);
  }
}

export async function getUserById(id: any) {
  try {
    let users = await userModel.findById(id);
    return users;
  } catch (err) {
    throw Error(`${err}`);
  }
}

export async function saveUser(user: any) {
  try {
    let nUser = new userModel(user);
    let savedUser = await nUser.save();
    return savedUser;
  } catch (err) {
    throw Error(`${err}`);
  }
}
