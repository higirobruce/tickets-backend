"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllUsers = getAllUsers;
exports.countUsers = countUsers;
exports.getUser = getUser;
exports.getUserById = getUserById;
exports.saveUser = saveUser;
const users_1 = require("../models/users");
const users_2 = require("../services/users");
const WITHOUT_CREDENTIALS = "-password -salt";
function getAllUsers() {
    return __awaiter(this, void 0, void 0, function* () {
        return users_1.userModel.find({}).select(WITHOUT_CREDENTIALS);
    });
}
function countUsers() {
    return __awaiter(this, void 0, void 0, function* () {
        return users_1.userModel.countDocuments();
    });
}
function getUser(username, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield users_1.userModel.findOne({ email: username });
        if (user && (0, users_2.validPassword)(password, user.password, user.salt)) {
            return user;
        }
        return null;
    });
}
function getUserById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return users_1.userModel.findById(id).select(WITHOUT_CREDENTIALS);
    });
}
function saveUser(user) {
    return __awaiter(this, void 0, void 0, function* () {
        const nUser = new users_1.userModel(user);
        return nUser.save();
    });
}
