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
exports.saveUser = exports.getUserById = exports.getUser = exports.getAllUsers = void 0;
const users_1 = require("../models/users");
const users_2 = require("../services/users");
function getAllUsers() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let users = yield users_1.userModel.find({});
            return users;
        }
        catch (err) {
            throw Error(`${err}`);
        }
    });
}
exports.getAllUsers = getAllUsers;
function getUser(username, password) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let user = yield users_1.userModel.findOne({ email: username });
            if ((0, users_2.validPassword)(password, user === null || user === void 0 ? void 0 : user.password)) {
                return user;
            }
            else {
                return false;
            }
        }
        catch (err) {
            throw Error(`${err}`);
        }
    });
}
exports.getUser = getUser;
function getUserById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let users = yield users_1.userModel.findById(id);
            return users;
        }
        catch (err) {
            throw Error(`${err}`);
        }
    });
}
exports.getUserById = getUserById;
function saveUser(user) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let nUser = new users_1.userModel(user);
            let savedUser = yield nUser.save();
            return savedUser;
        }
        catch (err) {
            throw Error(`${err}`);
        }
    });
}
exports.saveUser = saveUser;
